/* TBH Pixel Auto Battler - central web data contract v0.6.46
 * Supabase is authoritative. UI and Phaser consume the same get_player_game_state payload.
 */
(function () {
  "use strict";

  const SUPABASE_URL = "https://syzjmokthuuprlbbcvew.supabase.co";
  const SUPABASE_KEY = "sb_publishable_J4MMp1j4Gj4hOF8sGIEmZA_fBaJ3j8g";
  const VERSION_FALLBACK = "v0.6.46";
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  window.tbhSupabase = db;

  let currentState = null;
  let currentSession = null;
  let combatTimer = null;
  let combatBusy = false;
  let refreshBusy = false;
  let lastCombatErrorAt = 0;

  const $ = (id) => document.getElementById(id);
  const show = (id, visible) => { const node = $(id); if (node) node.hidden = !visible; };
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value == null ? "" : String(value); };
  const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : (fallback || 0);
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function setMessage(message, isError) {
    const node = $("web-message");
    if (!node) return;
    node.textContent = message || "";
    node.dataset.kind = isError ? "error" : "info";
  }

  function setStatus(message) {
    text("connection-status", message);
  }

  function stopCombatLoop() {
    if (combatTimer) window.clearInterval(combatTimer);
    combatTimer = null;
    combatBusy = false;
  }

  function renderStats(state) {
    const stats = state && state.stats ? state.stats : {};
    text("stat-atk", num(stats.atk));
    const hardDef = num(stats.hard_def);
    const softDef = num(stats.soft_def);
    const totalDef = stats.def == null ? hardDef + softDef : num(stats.def);
    text("stat-def", totalDef);
    text("stat-hard-def", hardDef);
    text("stat-soft-def", softDef);
    
    text("stat-hp", num(stats.hp) + " / " + num(stats.max_hp));
    text("stat-aspd", num(stats.aspd, 1).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " ครั้ง/วินาที");
    text("stat-hit", num(stats.hit).toFixed(0) + "%");
    text("stat-flee", num(stats.flee).toFixed(0) + "%");
    text("stat-crit", num(stats.crit).toFixed(0) + "%");
    text("stat-vit", num(stats.vit));
    text("stat-dex", num(stats.dex));
    text("stat-agi", num(stats.agi));
    text("stat-luk", num(stats.luk));
    text("stat-points", num(stats.stat_points));
  }

  function renderInventory(state) {
    const list = $("inventory-list");
    if (!list) return;
    const inventory = Array.isArray(state && state.inventory) ? state.inventory : [];
    if (!inventory.length) {
      list.innerHTML = '<div class="empty-state">ยังไม่มีไอเทมในกระเป๋า</div>';
      return;
    }
    list.innerHTML = inventory.map((item) => {
      const stats = [];
      if (num(item.base_atk)) stats.push("ATK +" + num(item.base_atk));
      if (num(item.base_def)) stats.push("Hard DEF +" + num(item.base_def));
      if (num(item.base_hp)) stats.push("HP +" + num(item.base_hp));
      const equipped = !!item.equipped;
      return '<article class="inventory-item">' +
        '<div class="inventory-item-info"><strong>' + esc(item.name || item.item_template_id) + '</strong>' +
        '<small>' + esc(item.slot || "item") + ' · Tier ' + esc(item.tier || 1) +
        (stats.length ? ' · ' + esc(stats.join(" / ")) : "") + '</small></div>' +
        (equipped ? '<span class="equipped-label">สวมใส่อยู่</span>' :
          '<button type="button" class="small-button" data-equip-id="' + esc(item.id) + '">สวมใส่</button>') +
        '</article>';
    }).join("");
  }

  function renderState(state) {
    if (!state || state.success !== true) return;
    currentState = state;
    const player = state.player || {};
    const stage = state.stageStatus || {};
    text("player-name", player.nickname || "ตัวละคร");
    text("player-level", "Lv. " + num(player.level, 1));
    text("player-gold", num(player.gold).toLocaleString());
    text("player-exp", num(player.exp).toLocaleString());
    text("player-stage", "ด่าน " + num(stage.current_farm_stage, 1));
    text("stage-progress", num(stage.kills_in_stage) + " / " + num(stage.kill_quota, 100));
    text("game-version", state.version || VERSION_FALLBACK);
    show("character-panel", !player.character_created);
    show("game-dashboard", !!player.character_created);
    show("challenge-button", !!stage.challenge_ready);
    renderStats(state);
    renderInventory(state);
    const combat = state.combat || {};
    if (combat.player_hp != null) text("combat-hint", "HP ผู้เล่น " + num(combat.player_hp) + "/" + num(combat.player_max_hp) + " · สถานะจาก Supabase");
  }

  async function loadState() {
    if (!currentSession || refreshBusy) return null;
    refreshBusy = true;
    try {
      const { data, error } = await db.rpc("get_player_game_state");
      if (error) throw error;
      if (!data || data.success !== true) throw new Error("โหลดสถานะตัวละครไม่สำเร็จ");
      renderState(data);
      if (data.player && data.player.character_created) {
        if (typeof window.initGameState === "function") window.initGameState(data);
        setStatus("เชื่อม Supabase แล้ว · " + (data.player.nickname || "ตัวละคร"));
        startCombatLoop();
      } else {
        stopCombatLoop();
        setStatus("เข้าสู่ระบบแล้ว · กรุณาสร้างตัวละคร");
        if (typeof window.initGameState === "function") {
          window.initGameState({ player: data.player || {}, stageStatus: data.stageStatus || {}, map: data.map || {}, monster: null });
        }
      }
      return data;
    } catch (error) {
      console.error("TBH loadState failed", error);
      setStatus("โหลดข้อมูลไม่สำเร็จ");
      setMessage(error.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล", true);
      return null;
    } finally {
      refreshBusy = false;
    }
  }

  async function signIn() {
    const email = ($("auth-email") && $("auth-email").value || "").trim();
    const password = $("auth-password") && $("auth-password").value || "";
    if (!email || !password) return setMessage("กรอกอีเมลและรหัสผ่านก่อน", true);
    setMessage("กำลังเข้าสู่ระบบ…", false);
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return setMessage(error.message, true);
    currentSession = data.session;
    show("auth-panel", false);
    setMessage("เข้าสู่ระบบสำเร็จ", false);
    await loadState();
  }

  async function signUp() {
    const email = ($("auth-email") && $("auth-email").value || "").trim();
    const password = $("auth-password") && $("auth-password").value || "";
    if (!email || !password) return setMessage("กรอกอีเมลและรหัสผ่านก่อน", true);
    if (password.length < 6) return setMessage("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", true);
    setMessage("กำลังสร้างบัญชี…", false);
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) return setMessage(error.message, true);
    if (!data.session) {
      setMessage("สร้างบัญชีแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ แล้วกลับมาล็อกอิน", false);
      return;
    }
    currentSession = data.session;
    show("auth-panel", false);
    setMessage("สร้างบัญชีสำเร็จ", false);
    await loadState();
  }

  async function signOut() {
    stopCombatLoop();
    const { error } = await db.auth.signOut();
    if (error) setMessage(error.message, true);
    currentSession = null;
    currentState = null;
    show("auth-panel", true);
    show("character-panel", false);
    show("game-dashboard", false);
    setStatus("ยังไม่ได้เข้าสู่ระบบ");
    setMessage("ออกจากระบบแล้ว", false);
    if (typeof window.initGameState === "function") window.initGameState({ player: {}, stageStatus: {}, monster: null });
  }

  async function createCharacter() {
    const nickname = ($("character-name") && $("character-name").value || "").trim();
    if (!nickname) return setMessage("กรอกชื่อตัวละครก่อน", true);
    setMessage("กำลังสร้างตัวละคร…", false);
    const { data, error } = await db.rpc("create_character", { p_nickname: nickname });
    if (error) return setMessage(error.message, true);
    if (!data || data.success !== true) return setMessage((data && data.message) || (data && data.error) || "สร้างตัวละครไม่สำเร็จ", true);
    setMessage("สร้างตัวละครสำเร็จ", false);
    await loadState();
  }

  async function equipItem(inventoryId) {
    if (!inventoryId) return;
    setMessage("กำลังสวมใส่อุปกรณ์…", false);
    const { data, error } = await db.rpc("equip_item", { p_inventory_id: inventoryId });
    if (error) return setMessage(error.message, true);
    if (!data || data.success !== true) return setMessage((data && data.message) || "สวมใส่อุปกรณ์ไม่สำเร็จ", true);
    setMessage("สวมใส่อุปกรณ์แล้ว · กำลังอัปเดตค่าสถานะ", false);
    await loadState();
  }

  async function tickCombat() {
    if (combatBusy || !currentSession || !currentState || !currentState.player || !currentState.player.character_created) return;
    combatBusy = true;
    try {
      const range = typeof window.getCombatRangeState === "function"
        ? window.getCombatRangeState()
        : { playerInRange: false, monsterInRange: false };
      const { data, error } = await db.rpc("advance_combat", {
        p_player_in_range: !!range.playerInRange,
        p_monster_in_range: !!range.monsterInRange
      });
      if (error) throw error;
      if (!data || data.success !== true) throw new Error("เซิร์ฟเวอร์ไม่ยืนยันสถานะการต่อสู้");
      let result = data;
      if (data.status !== "monster_defeated" && data.monster_id) {
        const targetResult = await db.rpc("get_current_combat_target");
        const targetRows = targetResult.data;
        const target = Array.isArray(targetRows) ? targetRows[0] : targetRows;
        if (!targetResult.error && target && String(target.monster_id) === String(data.monster_id)) {
          result = Object.assign({}, data, {
            monster_name: target.monster_name,
            monster_type: target.monster_type,
            is_boss: target.is_boss,
            monster_atk: target.monster_atk,
            monster_level: target.monster_level
          });
        }
      }
      if (typeof window.onServerCombatUpdate === "function") window.onServerCombatUpdate(result);
      if (result.status === "monster_defeated") {
        await loadState();
      } else if (currentState && currentState.stats) {
        currentState.combat = currentState.combat || {};
        currentState.combat.player_hp = result.player_hp;
        currentState.combat.player_max_hp = result.player_max_hp;
        currentState.stats.hp = result.player_hp;
        currentState.stats.max_hp = result.player_max_hp;
        renderStats(currentState);
        text("combat-hint", "HP ผู้เล่น " + num(result.player_hp) + "/" + num(result.player_max_hp) +
          " · HP มอนสเตอร์ " + num(result.monster_hp) + "/" + num(result.monster_max_hp) + " · ยืนยันโดย Supabase");
      }
    } catch (error) {
      const now = Date.now();
      if (now - lastCombatErrorAt > 5000) {
        console.error("TBH combat tick failed", error);
        setMessage(error.message || "การต่อสู้เชื่อมต่อไม่สำเร็จ", true);
        lastCombatErrorAt = now;
      }
    } finally {
      combatBusy = false;
    }
  }

  function startCombatLoop() {
    if (combatTimer) return;
    combatTimer = window.setInterval(tickCombat, 1000);
    tickCombat();
  }

  async function useUltimate() {
    if (!currentSession) return setMessage("กรุณาเข้าสู่ระบบก่อน", true);
    const range = typeof window.getCombatRangeState === "function"
      ? window.getCombatRangeState()
      : { playerInRange: false };
    const { data, error } = await db.rpc("use_ultimate", { p_player_in_range: !!range.playerInRange });
    if (error) return setMessage(error.message, true);
    if (data && data.success) {
      if (typeof window.onServerCombatUpdate === "function") {
        window.onServerCombatUpdate(data);
      }
      setMessage("Ultimate: เซิร์ฟเวอร์ยืนยันผลแล้ว", false);
      if (data.status === "monster_defeated") await loadState();
    } else {
      setMessage((data && data.message) || (data && data.error) || "ใช้ Ultimate ไม่สำเร็จ", true);
    }
  }

  async function challengeStage() {
    if (!currentSession) return setMessage("กรุณาเข้าสู่ระบบก่อน", true);
    const { data: stage, error: stageError } = await db.rpc("get_stage_status");
    if (stageError) return setMessage(stageError.message, true);
    if (!stage || !stage.challenge_ready || !stage.challenge_monster_id) {
      return setMessage("ต้องกำจัดมอนสเตอร์ให้ครบ 100 ตัวก่อนจึงจะ Challenge ได้", true);
    }
    const { data, error } = await db.rpc("resolve_stage_challenge", { p_monster_id: String(stage.challenge_monster_id) });
    if (error) return setMessage(error.message, true);
    if (!data || data.success !== true) return setMessage((data && data.message) || "เริ่ม Challenge ไม่สำเร็จ", true);
    setMessage("เริ่ม Challenge แล้ว · สถานะยืนยันโดย Supabase", false);
    await loadState();
    if (typeof window.onServerCombatUpdate === "function") window.onServerCombatUpdate(data);
  }

  async function handleGameEvent(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.event === "ULTIMATE_REQUEST") return useUltimate();
    if (payload.event === "STAGE_CHALLENGE_REQUEST") return challengeStage();
    if (payload.event === "MONSTER_KILL_REQUEST") {
      // Normal kills are resolved only by advance_combat; never trust a client kill event as a reward.
      return tickCombat();
    }
  }

  async function init() {
    text("game-version", VERSION_FALLBACK);
    try {
      const response = await fetch("version.json?ts=" + Date.now(), { cache: "no-store" });
      if (response.ok) {
        const versionData = await response.json();
        text("game-version", versionData.version || VERSION_FALLBACK);
      }
    } catch (_) { /* version label keeps its safe fallback */ }

    $("login-button") && $("login-button").addEventListener("click", signIn);
    $("signup-button") && $("signup-button").addEventListener("click", signUp);
    $("logout-button") && $("logout-button").addEventListener("click", signOut);
    $("create-character-button") && $("create-character-button").addEventListener("click", createCharacter);
    $("ultimate-button") && $("ultimate-button").addEventListener("click", () => {
      if (typeof window.triggerHeroSkill === "function") window.triggerHeroSkill("ultimate");
      else useUltimate();
    });
    $("challenge-button") && $("challenge-button").addEventListener("click", challengeStage);
    $("refresh-button") && $("refresh-button").addEventListener("click", loadState);
    $("inventory-list") && $("inventory-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-equip-id]");
      if (button) equipItem(button.getAttribute("data-equip-id"));
    });
    $("auth-password") && $("auth-password").addEventListener("keydown", (event) => {
      if (event.key === "Enter") signIn();
    });

    db.auth.onAuthStateChange((_event, session) => {
      currentSession = session;
      if (!session) {
        stopCombatLoop();
        show("auth-panel", true);
        show("character-panel", false);
        show("game-dashboard", false);
        setStatus("ยังไม่ได้เข้าสู่ระบบ");
      } else {
        show("auth-panel", false);
        // Supabase auth callback should not await inside this callback.
        window.setTimeout(() => loadState(), 0);
      }
    });
    const { data } = await db.auth.getSession();
    currentSession = data.session;
    if (currentSession) {
      show("auth-panel", false);
      await loadState();
    } else {
      show("auth-panel", true);
      show("character-panel", false);
      show("game-dashboard", false);
      setStatus("ยังไม่ได้เข้าสู่ระบบ");
    }
  }

  window.TBHGame = {
    db,
    getState: () => currentState,
    refreshState: loadState,
    handleGameEvent,
    signIn,
    signUp,
    signOut,
    useUltimate,
    challengeStage
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();