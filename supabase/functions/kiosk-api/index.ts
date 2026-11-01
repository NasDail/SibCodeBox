import { corsHeaders, errorResponse, jsonResponse, readJson, serviceClient, sha256Hex, randomToken, normalizeNick, stringValue } from "../_shared/common.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", 405);

  try {
    const body = await readJson(req);
    const action = stringValue(body.action, 40);
    const client = serviceClient();

    if (action === "redeem_session") {
      const token = stringValue(body.token, 200);
      if (token.length < 40 || token.length > 200) return errorResponse("QR_TOKEN_INVALID");
      const tokenHash = await sha256Hex(token);
      const sessionKey = randomToken(32);
      const sessionKeyHash = await sha256Hex(sessionKey);
      // SQL RPC атомарно помечает QR использованным и запускает duration от момента сканирования.
      const { data, error } = await client.rpc("redeem_scbb_session", { p_qr_token_hash: tokenHash, p_session_key_hash: sessionKeyHash });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return errorResponse("QR-код истёк, уже использован или отозван.", 403);
      return jsonResponse({ ok: true, session_id: row.session_id, session_key: sessionKey, expires_at: row.expires_at, owner_name: row.owner_name });
    }

    if (action === "check_session") {
      const sessionKey = stringValue(body.session_key, 200);
      if (sessionKey.length < 40) return errorResponse("SESSION_KEY_INVALID");
      const digest = await sha256Hex(sessionKey);
      const now = new Date().toISOString();
      const { data: session, error } = await client.from("sessions")
        .select("id,expires_at,status").eq("session_key_hash", digest)
        .eq("status", "active").gt("expires_at", now).maybeSingle();
      if (error) throw error;
      return jsonResponse({ ok: true, active: Boolean(session), expires_at: session?.expires_at || null });
    }

    if (action === "submit_record") {
      const sessionKey = stringValue(body.session_key, 200);
      const gameId = stringValue(body.game_id, 120);
      const nick = stringValue(body.nick, 20);
      const score = Number(body.score);
      if (sessionKey.length < 40 || !gameId || !Number.isSafeInteger(score) || score < 0 || score > 1_000_000_000) {
        return errorResponse("INVALID_RECORD_DATA");
      }
      if (nick.length < 2 || nick.length > 20 || normalizeNick(nick).length < 2) return errorResponse("Некорректный ник.");
      const sessionKeyHash = await sha256Hex(sessionKey);
      const now = new Date().toISOString();
      const { data: session, error: sessionError } = await client.from("sessions")
        .select("id,owner_name,expires_at,status").eq("session_key_hash", sessionKeyHash)
        .eq("status", "active").gt("expires_at", now).maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return errorResponse("Сессия закончилась или недействительна.", 403);

      const { data: game, error: gameError } = await client.from("games")
        .select("id").eq("id", gameId).eq("is_active", true).maybeSingle();
      if (gameError) throw gameError;
      if (!game) return errorResponse("Игра больше не доступна.", 404);

      const { data: allowed, error: nickError } = await client.rpc("is_nick_allowed", { p_nick: nick });
      if (nickError) throw new Error("Не удалось проверить ник. Попробуй позже.");
      if (allowed !== true) return errorResponse("Этот ник не подходит. Выбери другой.", 422);

      const { data: inserted, error: insertError } = await client.from("records").insert({
        game_id: gameId, session_id: session.id, nick, player_name: nick, score, hidden: false, banned: false,
      }).select("id,created_at,score").single();
      if (insertError) {
        if (String(insertError.message).includes("NICK_NOT_ALLOWED")) return errorResponse("Этот ник скрыт, заблокирован или запрещён стоп-листом.", 422);
        throw insertError;
      }
      const { count, error: countError } = await client.from("records").select("id", { count: "exact", head: true })
        .eq("game_id", gameId).eq("hidden", false).eq("banned", false).gt("score", score);
      if (countError) throw countError;
      return jsonResponse({ ok: true, record_id: inserted.id, rank: (count || 0) + 1, created_at: inserted.created_at });
    }

    if (action === "end_session") {
      const sessionKey = stringValue(body.session_key, 200);
      if (sessionKey.length < 40) return errorResponse("SESSION_KEY_INVALID");
      const digest = await sha256Hex(sessionKey);
      const { error } = await client.from("sessions").update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("session_key_hash", digest).eq("status", "active");
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    return errorResponse("UNKNOWN_ACTION", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("kiosk-api:", message);
    return errorResponse(message, 500);
  }
});
