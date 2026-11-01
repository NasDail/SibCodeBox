import {
  corsHeaders, errorResponse, jsonResponse, readJson, requireAdmin,
  normalizeNick, stringValue, sha256Hex, randomToken,
} from "../_shared/common.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", 405);

  try {
    const { client, admin } = await requireAdmin(req);
    const body = await readJson(req);
    const action = stringValue(body.action, 60);

    if (action === "create_session") {
      const minutes = Number(body.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) return errorResponse("Длительность должна быть от 1 до 720 минут.");
      const ownerName = stringValue(body.owner_name, 40) || "Игрок";
      const ownerClass = stringValue(body.owner_class, 12) || null;
      const token = randomToken(32);
      const tokenHash = await sha256Hex(token);
      const createdAt = new Date();
      const qrExpiresAt = new Date(createdAt.getTime() + 30 * 60_000).toISOString();
      const { data, error } = await client.from("sessions").insert({
        qr_token_hash: tokenHash,
        created_by: admin.userId,
        owner_name: ownerName,
        owner_class: ownerClass,
        minutes,
        qr_expires_at: qrExpiresAt,
        expires_at: null,
        status: "issued",
      }).select("id,expires_at,created_at,minutes,owner_name,status").single();
      if (error) throw error;
      return jsonResponse({ ok: true, session: data, session_id: data.id, expires_at: qrExpiresAt, qr_expires_at: qrExpiresAt, owner_name: ownerName,
        qr_payload: JSON.stringify({ type: "scbb-session", token, expires_at: qrExpiresAt, duration_minutes: minutes }) });
    }

    if (action === "list_sessions") {
      await client.from("sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("status", "issued").lte("qr_expires_at", new Date().toISOString());
      await client.from("sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("status", "active").lte("expires_at", new Date().toISOString());
      const { data, error } = await client.from("sessions")
        .select("id,owner_name,owner_class,minutes,started_at,expires_at,qr_expires_at,status,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return jsonResponse({ ok: true, sessions: data || [] });
    }

    if (action === "revoke_session") {
      const id = stringValue(body.session_id, 80);
      const { data, error } = await client.from("sessions").update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", id).in("status", ["issued", "active"]).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return errorResponse("Сессия уже завершена или не найдена.");
      return jsonResponse({ ok: true });
    }

    if (action === "list_offenders") {
      const [{ data: records, error: recordsError }, { data: games, error: gamesError }, { data: stopRow }, { data: blocks }] = await Promise.all([
        client.from("records").select("id,game_id,nick,player_name,score,created_at,hidden,banned").order("created_at", { ascending: false }).limit(2000),
        client.from("games").select("id,title"),
        client.from("config").select("value").eq("key", "nickname_stoplist").maybeSingle(),
        client.from("nick_blocks").select("normalized_nick,block_type"),
      ]);
      if (recordsError) throw recordsError;
      if (gamesError) throw gamesError;
      let words: string[] = [];
      try { const parsed = JSON.parse(stopRow?.value || "[]"); if (Array.isArray(parsed)) words = parsed.map(String); } catch { /* пустой стоп-лист не переопределяет серверный SQL guard */ }
      const blocked = new Set((blocks || []).map((row: { normalized_nick: string }) => row.normalized_nick));
      const gameMap = new Map<string, string>();
      for (const game of games || []) gameMap.set((game as { id: string; title: string }).id, (game as { id: string; title: string }).title);
      const offenders = (records || []).filter((record: Record<string, unknown>) => {
        const nick = String(record.nick || record.player_name || "");
        const normalized = normalizeNick(nick);
        const stopMatch = words.some((word) => normalized.includes(normalizeNick(word)));
        return Boolean(record.hidden || record.banned || blocked.has(normalized) || stopMatch);
      }).map((record: Record<string, unknown>) => ({ ...record, game_title: gameMap.get(String(record.game_id)) || record.game_id }));
      return jsonResponse({ ok: true, offenders });
    }

    if (action === "moderate_nick") {
      const recordId = Number(body.record_id);
      const mode = stringValue(body.mode, 20);
      if (!Number.isInteger(recordId) || recordId < 1 || !["hidden", "banned"].includes(mode)) return errorResponse("Некорректные параметры модерации.");
      const { data: record, error: recordError } = await client.from("records").select("id,nick,player_name").eq("id", recordId).single();
      if (recordError || !record) return errorResponse("Рекорд не найден.", 404);
      const { data: updated, error } = await client.rpc("moderate_records_by_nick", {
        p_record_id: recordId, p_mode: mode, p_admin_id: admin.userId,
      });
      if (error) throw error;
      return jsonResponse({ ok: true, updated: Number(updated || 0), nick: record.nick || record.player_name });
    }

    if (action === "get_stoplist") {
      const { data, error } = await client.from("config").select("value").eq("key", "nickname_stoplist").maybeSingle();
      if (error) throw error;
      let words: string[] = [];
      try { const parsed = JSON.parse(data?.value || "[]"); if (Array.isArray(parsed)) words = parsed.map(String); } catch { /* use empty */ }
      return jsonResponse({ ok: true, words });
    }

    if (action === "set_stoplist") {
      const source = Array.isArray(body.words) ? body.words : [];
      const words = [...new Set(source.map((value) => stringValue(value, 60)).filter((value) => value.length >= 2))].slice(0, 100);
      const { error } = await client.from("config").upsert({ key: "nickname_stoplist", value: JSON.stringify(words) });
      if (error) throw error;
      return jsonResponse({ ok: true, words });
    }

    if (action === "get_maintenance") {
      const { data, error } = await client.from("config").select("key,value").in("key", ["maintenance_mode", "maintenance_message"]);
      if (error) throw error;
      const config = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
      return jsonResponse({ ok: true, mode: config.maintenance_mode || "off", message: config.maintenance_message || "Идут технические работы." });
    }

    if (action === "set_maintenance") {
      const mode = body.mode === "on" ? "on" : "off";
      const message = stringValue(body.message, 500) || "Идут технические работы. Автомат скоро вернётся!";
      const { error } = await client.from("config").upsert([
        { key: "maintenance_mode", value: mode }, { key: "maintenance_message", value: message },
      ]);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === "force_sync") {
      if (admin.role !== "developer") return errorResponse("Только разработчик может принудительно синхронизировать автоматы.", 403);
      const requestedAt = new Date().toISOString();
      const { error } = await client.from("config").upsert({ key: "catalog_sync_version", value: requestedAt });
      if (error) throw error;
      return jsonResponse({ ok: true, requested_at: requestedAt });
    }

    if (action === "update_game") {
      if (admin.role !== "developer") return errorResponse("Редактирование доступно только разработчику.", 403);
      const game = (body.game || {}) as Record<string, unknown>;
      const id = stringValue(game.id, 120);
      const patch = {
        title: stringValue(game.title, 80), description: stringValue(game.description, 1200),
        genre: stringValue(game.genre, 50) || "Аркада", developer: stringValue(game.developer, 80) || "Не указан",
        updated_at: new Date().toISOString(),
      };
      if (!id || !patch.title) return errorResponse("Укажи ID и название игры.");
      const { error } = await client.from("games").update(patch).eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === "delete_game") {
      if (admin.role !== "developer") return errorResponse("Удаление доступно только разработчику.", 403);
      const id = stringValue(body.game_id, 120);
      const { error } = await client.from("games").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return jsonResponse({ ok: true, archived: true });
    }

    return errorResponse("UNKNOWN_ACTION", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message.includes("AUTH") ? 401 : message.includes("ROLE") ? 403 : 500;
    console.error("admin-api:", message);
    return errorResponse(message, status);
  }
});
