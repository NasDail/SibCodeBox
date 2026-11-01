import { corsHeaders, errorResponse, jsonResponse, readJson, requireAdmin, stringValue } from "../_shared/common.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 80;
const OWNER_DEFAULT = "NasDail";
const REPO_DEFAULT = "SibCodeBox";
const BRANCH_DEFAULT = "main";
const ROOT_DEFAULT = "games";

function validPath(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !path.startsWith("/") && !path.includes("\\") &&
    path.split("/").every((part) => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}

function rawUrl(owner: string, repo: string, branch: string, root: string, slug: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${root}/${slug}/${encoded}`;
}

async function githubRequest(url: string, token: string, init?: RequestInit): Promise<Response> {
  return await fetch(url, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", 405);

  try {
    const { client } = await requireAdmin(req, ["teacher", "developer"]);
    const body = await readJson(req);
    if (body.action !== "publish") return errorResponse("UNKNOWN_ACTION", 404);

    const token = Deno.env.get("GITHUB_TOKEN");
    if (!token) return errorResponse("GITHUB_TOKEN secret is not configured in Supabase.", 500);
    const owner = Deno.env.get("GITHUB_OWNER") || OWNER_DEFAULT;
    const repo = Deno.env.get("GITHUB_REPO") || REPO_DEFAULT;
    const branch = Deno.env.get("GITHUB_BRANCH") || BRANCH_DEFAULT;
    const root = (Deno.env.get("GAMES_ROOT") || ROOT_DEFAULT).replace(/^\/+|\/+$/g, "");

    const game = (body.game || {}) as Record<string, unknown>;
    const slug = stringValue(game.slug || game.id, 100).toLowerCase();
    const title = stringValue(game.title, 80);
    const description = stringValue(game.description, 1200);
    const genre = stringValue(game.genre, 50);
    const developer = stringValue(game.developer, 80);
    if (!/^[a-z0-9][a-z0-9-]{1,90}$/.test(slug)) return errorResponse("Некорректный slug игры.");
    if (!title || !description || !genre || !developer) return errorResponse("Заполните все поля игры.");

    if (!Array.isArray(body.files) || body.files.length < 2 || body.files.length > MAX_FILES) return errorResponse(`Число файлов должно быть от 2 до ${MAX_FILES}.`);
    let total = 0;
    const seen = new Set<string>();
    const files: Array<{ path: string; content_base64: string; mime: string; size: number }> = [];
    for (const raw of body.files) {
      if (!raw || typeof raw !== "object") return errorResponse("Некорректный объект файла.");
      const file = raw as Record<string, unknown>;
      const path = stringValue(file.path, 240);
      const content = stringValue(file.content_base64, MAX_BYTES * 2);
      const mime = stringValue(file.mime, 100) || "application/octet-stream";
      if (!validPath(path) || seen.has(path)) return errorResponse(`Недопустимый или повторяющийся путь: ${path}`);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 !== 0) return errorResponse(`Файл ${path} имеет некорректное base64-содержимое.`);
      const estimatedSize = Math.floor(content.length * 3 / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
      total += estimatedSize;
      if (total > MAX_BYTES) return errorResponse("Распакованный архив превышает ограничение 4 МБ.");
      seen.add(path);
      files.push({ path, content_base64: content, mime, size: estimatedSize });
    }
    if (!seen.has("index.html") || !seen.has("icon.png")) return errorResponse("В архиве обязательны index.html и icon.png в корне.");

    const rawBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const fileMetadata: Array<{ path: string; raw_url: string; mime: string; size: number }> = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const githubPath = `${root}/${slug}/${file.path}`;
      const apiUrl = `${rawBase}/${githubPath.split("/").map(encodeURIComponent).join("/")}`;
      let sha: string | undefined;
      const current = await githubRequest(`${apiUrl}?ref=${encodeURIComponent(branch)}`, token);
      if (current.ok) {
        const currentJson = await current.json();
        if (typeof currentJson.sha === "string") sha = currentJson.sha;
      } else if (current.status !== 404) {
        const detail = await current.text();
        throw new Error(`GitHub GET ${githubPath}: ${current.status} ${detail.slice(0, 300)}`);
      }
      const putBody: Record<string, unknown> = {
        message: `Publish ${slug}: ${file.path}`,
        content: file.content_base64,
        branch,
      };
      if (sha) putBody.sha = sha;
      const uploaded = await githubRequest(apiUrl, token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(putBody),
      });
      if (!uploaded.ok) {
        const detail = await uploaded.text();
        throw new Error(`GitHub PUT ${githubPath}: ${uploaded.status} ${detail.slice(0, 400)}`);
      }
      fileMetadata.push({ path: file.path, raw_url: rawUrl(owner, repo, branch, root, slug, file.path), mime: file.mime, size: file.size });
    }

    const repoUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${root}/${slug}`;
    const entryUrl = rawUrl(owner, repo, branch, root, slug, "index.html");
    const iconUrl = rawUrl(owner, repo, branch, root, slug, "icon.png");
    const { error: dbError } = await client.from("games").upsert({
      id: slug, slug, title, description, genre, developer,
      icon_url: iconUrl, repo_url: repoUrl, entry_url: entryUrl,
      files_json: fileMetadata, is_active: true, updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (dbError) throw new Error(`Файлы загружены в GitHub, но запись каталога не сохранена: ${dbError.message}`);

    return jsonResponse({ ok: true, game: { id: slug, slug, title, repo_url: repoUrl, entry_url: entryUrl, icon_url: iconUrl }, files: fileMetadata.length, bytes: total });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.includes("AUTH") ? 401 : message.includes("ROLE") ? 403 : 500;
    console.error("publish-game:", message);
    return errorResponse(message, status);
  }
});
