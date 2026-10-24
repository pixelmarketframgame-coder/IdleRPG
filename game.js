// ==========================================
// Global Variables & Scene Reference
// ==========================================
let gameScene = null; // เก็บ Reference ตัวเกมให้ HTML เรียกใช้ได้ตลอดเวลา

let bgFar, bgMid, bgFloor;
let hero, pet, enemy, portal;
let enemyHp = 100, maxEnemyHp = 100;
let enemyHpBarBg, enemyHpBar, enemyHpText, enemyNameText, topBanner, topBannerText;
let farmProgressBg = null, farmProgressBarBg = null, farmProgressBar = null, farmProgressText = null;

let currentStage = "1";
let killsInStage = 0;
const maxKillsPerStage = 100;
let isBossFight = false;
let currentMonsterId = null;
let currentMonsterType = "normal";
let isChallengeTarget = false;
let awaitingServerResponse = false;
let combatPaused = true;
let stageLabelText = null;
let combatTimer = null;
let serverPlayerHp = 100, serverPlayerMaxHp = 100;
let lastServerCombatStatus = null;
// Combat HP and outcomes are authoritative in Supabase RPC advance_combat.
let playerHpBarBg = null, playerHpBar = null, playerHpText = null;
let lastDisplayedPlayerHp = null;
let lastDisplayedMonsterHp = null;
let lastDisplayedMonsterId = null;

// Combat arena uses 50 logical tiles across the 520px Phaser viewport.
const ARENA_TILES = 50;
const TILE_SIZE_PX = 10;
const ARENA_WIDTH_PX = ARENA_TILES * TILE_SIZE_PX;
const PLAYER_START_X = 440;
const MONSTER_START_X = 90;
const combatProfile = {
    weaponType: "bow",
    attackRangeTiles: 10,
    moveSpeedPxPerSecond: 36
};
let monsterCombatProfile = {
    attackRangeTiles: 1,
    moveSpeedPxPerSecond: 25,
    style: "melee"
};
let combatDistanceText = null;

// ==========================================
// Bridge Functions (เรียกจาก HTML Control Panel)
// ==========================================
window.changePetSkin = function(skinType) {
    if (!pet) return;

    // ถ้าส่งค่า 'none' หรือไม่ส่งอะไรมา ให้ซ่อนสัตว์เลี้ยง
    if (!skinType || skinType === 'none') {
        pet.setVisible(false);
        console.log("Pet unequipped (Hidden)");
        return;
    }

    // 🌟 พระเอกอยู่ตรงนี้: สั่งให้กลับมาแสดงตัวอีกครั้ง!
    pet.setVisible(true);
    
    // เปลี่ยนรูปตามที่ส่งมา
    if (skinType === 'dragon') pet.setTexture('pet_dragon');
    else if (skinType === 'phoenix') pet.setTexture('pet_phoenix');
    else pet.setTexture('pet_slime');
    
    console.log("Pet changed to:", skinType);
};

window.triggerHeroSkill = function(skillName) {
    if (!gameScene || !hero || !enemy || combatPaused || awaitingServerResponse || !currentMonsterId || !enemy.visible) return;
    // Never show an attack before the player has reached the weapon's range.
    const distanceTiles = Math.abs(hero.x - enemy.x) / TILE_SIZE_PX;
    if (distanceTiles > combatProfile.attackRangeTiles) {
        showTopNotification("กำลังเดินเข้าระยะโจมตี...");
        return;
    }
    gameScene.cameras.main.shake(250, 0.012);
    const beam = gameScene.add.rectangle(enemy.x, 110, 50, 220, 0xf1c40f, 0.8);
    gameScene.tweens.add({
        targets: beam, alpha: 0, duration: 400,
        onComplete: () => {
            beam.destroy();
            applyDamage();
        }
    });
};

window.changeMapTheme = function(themeName) {
    if (!bgFar || !bgMid || !bgFloor) return;
    
    if (themeName === 'dungeon') {
        bgFar.setTexture('bg_dungeon_far');
        bgMid.setTexture('bg_dungeon_mid');
        bgFloor.setTexture('bg_dungeon_floor');
    } else if (themeName === 'lava') {
        bgFar.setTexture('bg_lava_far');
        bgMid.setTexture('bg_lava_mid');
        bgFloor.setTexture('bg_lava_floor');
    } else {
        bgFar.setTexture('bg_forest_far');
        bgMid.setTexture('bg_forest_mid');
        bgFloor.setTexture('bg_forest_floor');
    }
    console.log("Map theme changed to:", themeName);
};

window.forceSpawnBoss = function() {
    if (!gameScene) return;
    // โหมดทดสอบภาพเท่านั้น ไม่ได้เปลี่ยนสถานะด่านหรือให้รางวัลใน Supabase
    
    killsInStage = maxKillsPerStage;
    isBossFight = true;
    enemyHp = 300; 
    maxEnemyHp = 300;
    
    if (enemy) {
        enemy.setTexture('enemy_boss');
        enemy.setPosition(180, 155);
        enemy.setVisible(true);
        enemy.setAlpha(1);
        enemyNameText.setText("🔥 BOSS GIGANT").setColor("#f1c40f");
        updateEnemyHpBar();
        showTopNotification("⚠ WARNING! บอสประจำด่านปรากฏตัว!");
    }
    console.log("Boss spawned!");
};

window.challengeCurrentStage = function() {
    if (killsInStage < maxKillsPerStage) {
        showTopNotification("ต้องกำจัดมอนสเตอร์ครบ 100 ตัวก่อน!");
        return;
    }
    if (awaitingServerResponse) return;
    combatPaused = true;
    awaitingServerResponse = true;
    if (enemy) enemy.setVisible(false);
    sendToFlutterFlow({ event: "STAGE_CHALLENGE_REQUEST", stage: currentStage });
};

function sendToFlutterFlow(payload) {
    if (window.FlutterChannel && window.FlutterChannel.postMessage) {
        window.FlutterChannel.postMessage(JSON.stringify(payload));
    }
    if (payload.event === 'ITEM_DROPPED' && typeof addLootToInventoryUI === 'function') {
        addLootToInventoryUI(payload.icon, payload.itemName);
    }
}

// ==========================================
// Phaser Config & Lifecycle
// ==========================================
const config = {
    type: Phaser.AUTO,
    width: 520,
    height: 220,
    scale: {
        mode: Phaser.Scale.FIT, // สั่งให้ย่อ/ขยายภาพพอดีกับกรอบ WebView
        autoCenter: Phaser.Scale.CENTER_BOTH // จัดกึ่งกลางอัตโนมัติทั้งแนวตั้งและแนวนอน
    },
    parent: 'game-container',
    pixelArt: true,
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: { preload: preload, create: create, update: update }
};

const game = new Phaser.Game(config);

function preload() {
    let g = this.add.graphics();

    // 1. Forest
    g.fillStyle(0x1a252f); g.fillRect(0, 0, 520, 220); g.generateTexture('bg_forest_far', 520, 220); g.clear();
    g.fillStyle(0x273c75); g.fillRect(0, 80, 120, 100); g.fillRect(100, 60, 150, 120); g.generateTexture('bg_forest_mid', 520, 220); g.clear();
    g.fillStyle(0x2bc48a); g.fillRect(0, 0, 64, 30); g.fillStyle(0x1e8449); g.fillRect(0, 0, 64, 4); g.generateTexture('bg_forest_floor', 64, 30); g.clear();

    // 2. Dungeon
    g.fillStyle(0x111116); g.fillRect(0, 0, 520, 220); g.generateTexture('bg_dungeon_far', 520, 220); g.clear();
    g.fillStyle(0x2c3e50); g.fillRect(20, 40, 30, 140); g.fillRect(150, 40, 30, 140); g.generateTexture('bg_dungeon_mid', 520, 220); g.clear();
    g.fillStyle(0x7f8c8d); g.fillRect(0, 0, 64, 30); g.fillStyle(0x34495e); g.fillRect(0, 0, 64, 4); g.generateTexture('bg_dungeon_floor', 64, 30); g.clear();

    // 3. Lava
    g.fillStyle(0x2c0b0e); g.fillRect(0, 0, 520, 220); g.generateTexture('bg_lava_far', 520, 220); g.clear();
    g.fillStyle(0xb33939); g.fillRect(40, 90, 80, 90); g.fillRect(200, 70, 100, 110); g.generateTexture('bg_lava_mid', 520, 220); g.clear();
    g.fillStyle(0x218c74); g.fillRect(0, 0, 64, 30); g.fillStyle(0xff5252); g.fillRect(0, 0, 64, 4); g.generateTexture('bg_lava_floor', 64, 30); g.clear();

    // Sprites
    g.fillStyle(0xf1c40f); g.fillRect(4, 0, 16, 24); g.fillStyle(0x2ecc71); g.fillRect(0, 8, 24, 16); g.generateTexture('hero_sprite', 24, 24); g.clear();
    g.fillStyle(0x3498db); g.fillRect(2, 4, 12, 12); g.generateTexture('pet_slime', 16, 16); g.clear();
    g.fillStyle(0xe74c3c); g.fillRect(0, 0, 16, 16); g.fillRect(4, 4, 4, 4); g.generateTexture('pet_dragon', 16, 16); g.clear();
    g.fillStyle(0xe67e22); g.fillRect(2, 0, 12, 16); g.fillRect(0, 4, 16, 6); g.generateTexture('pet_phoenix', 16, 16); g.clear();
    g.fillStyle(0xdcdde1); g.fillRect(2, 2, 20, 22); g.generateTexture('enemy_normal', 24, 24); g.clear();
    g.fillStyle(0x8e44ad); g.fillRect(0, 0, 40, 44); g.fillStyle(0xe74c3c); g.fillRect(8, 8, 8, 8); g.fillRect(24, 8, 8, 8); g.generateTexture('enemy_boss', 40, 44); g.clear();
    // Visible pixel arrow with a bright shaft and arrowhead (larger than the old 14x6 sprite).
    g.fillStyle(0xffd166); g.fillRect(0, 4, 18, 4);
    g.fillStyle(0xff8c00); g.fillTriangle(15, 0, 24, 6, 15, 12);
    g.fillStyle(0xffffff); g.fillRect(3, 4, 7, 2);
    g.generateTexture('arrow_sprite', 25, 12); g.clear();
    g.fillStyle(0x9b59b6); g.fillRect(0, 0, 18, 16); g.generateTexture('chest_sprite', 18, 16); g.clear();
    g.fillStyle(0xf1c40f); g.fillCircle(4, 4, 4); g.generateTexture('coin_sprite', 8, 8); g.clear();
    g.fillStyle(0xffffff); g.fillRect(0, 0, 3, 3); g.generateTexture('spark_particle', 3, 3); g.clear();
    g.fillStyle(0xbdc3c7); g.fillRect(6, 0, 4, 16); g.fillStyle(0xe74c3c); g.fillRect(4, 12, 8, 3); g.generateTexture('item_sword', 16, 16); g.clear();
}

function create() {
    gameScene = this; // บันทึก Reference หลัก

    bgFar = this.add.tileSprite(260, 110, 520, 220, 'bg_forest_far');
    bgMid = this.add.tileSprite(260, 110, 520, 220, 'bg_forest_mid');
    bgFloor = this.add.tileSprite(260, 195, 520, 30, 'bg_forest_floor');

    const magicCircle = this.add.ellipse(390, 180, 50, 14);
    magicCircle.setStrokeStyle(2, 0xe67e22);

    portal = this.add.rectangle(50, 160, 24, 30, 0x0984e3);
    stageLabelText = this.add.text(50, 130, currentStage, { fontSize: '11px', backgroundColor: '#00000088', padding: { x: 4, y: 2 } }).setOrigin(0.5);

    hero = this.add.sprite(PLAYER_START_X, 165, 'hero_sprite').setDepth(5);
    combatDistanceText = this.add.text(260, 12, 'ระยะ -- ช่อง', {
        fontSize: '9px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2, backgroundColor: '#00000088',
        padding: { x: 4, y: 2 }, align: 'center'
    }).setOrigin(0.5).setDepth(50);
    // หลอดเลือดตัวละคร: ตำแหน่งคงที่เหนือหัว และค่าจริงอัปเดตจาก Supabase
    playerHpBarBg = this.add.rectangle(368, 137, 44, 5, 0x202020).setOrigin(0, 0.5).setDepth(8);
    playerHpBar = this.add.rectangle(368, 137, 44, 3, 0x2ecc71).setOrigin(0, 0.5).setDepth(9);
    playerHpText = this.add.text(390, 126, 'HP --/--', {
        fontSize: '8px', color: '#ffffff', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2, align: 'center'
    }).setOrigin(0.5).setDepth(10);
    pet = this.add.sprite(430, 170, 'pet_slime');
    pet.setVisible(false); // ซ่อนสัตว์เลี้ยงตอนเริ่มเกม

    // Create monster name and HP HUD directly in Phaser.
    enemyHpBarBg = this.add.rectangle(0, 0, 52, 7, 0x111111).setOrigin(0, 0.5).setDepth(30);
    enemyHpBar = this.add.rectangle(0, 0, 52, 4, 0x2ecc71).setOrigin(0, 0.5).setDepth(31);
    enemyHpText = this.add.text(0, 0, 'HP -- / --', { fontSize: '9px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center', backgroundColor: '#000000aa', padding: { x: 3, y: 2 } }).setOrigin(0.5).setDepth(32);
    enemyNameText = this.add.text(0, 0, 'Monster', { fontSize: '10px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center', backgroundColor: '#000000aa', padding: { x: 3, y: 2 } }).setOrigin(0.5).setDepth(33);
    enemyHpBarBg.setVisible(false); enemyHpBar.setVisible(false); enemyHpText.setVisible(false); enemyNameText.setVisible(false);
    // ❌ ลบบรรทัด spawnEnemy(); ออกไปเลยครับ

    topBanner = this.add.rectangle(260, -30, 340, 24, 0x000000, 0.85).setStrokeStyle(1, 0x555555);
    topBannerText = this.add.text(260, -30, '', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);

    // Farm progress HUD is rendered inside Phaser canvas (not HTML).
    farmProgressBg = this.add.rectangle(260, 32, 300, 26, 0x0b1713, 0.92)
        .setStrokeStyle(1, 0x34715c).setDepth(60);
    farmProgressText = this.add.text(260, 25, '⚔ ฟาร์มด่านนี้ 0 / 100 ตัว', {
        fontSize: '11px', color: '#9ff0c8', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2, align: 'center'
    }).setOrigin(0.5).setDepth(61);
    farmProgressBarBg = this.add.rectangle(118, 40, 284, 5, 0x050b09)
        .setOrigin(0, 0.5).setDepth(61);
    farmProgressBar = this.add.rectangle(118, 40, 0, 3, 0x35d07f)
        .setOrigin(0, 0.5).setDepth(62);
    updateFarmProgressHud();

    // ❌ ลบบรรทัด this.time.addEvent(...) ที่เป็นลูปโจมตีออกไปด้วยครับ
}

function update(_time, delta) {
    if (bgFar) bgFar.tilePositionX += 0.1;
    if (bgMid) bgMid.tilePositionX += 0.4;
    if (bgFloor) bgFloor.tilePositionX += 1.2;
    if (pet) {
        pet.y = 170 + Math.sin(this.time.now / 200) * 2;
        if (hero) pet.x = hero.x + 30;
    }
    updateCombatMovement(Math.min(50, Math.max(0, Number(delta) || 0)) / 1000);
}

function setPlayerCombatProfile(playerData = {}) {
    const equipment = playerData.equipment || playerData.equipped || {};
    const raw = playerData.weapon_type || playerData.weaponType ||
        playerData.weapon || equipment.weapon_type || equipment.weaponType ||
        equipment.weapon || playerData.active_weapon || "bow";
    const value = String(typeof raw === "object" ? (raw.type || raw.weapon_type || raw.name || "bow") : raw).toLowerCase();
    const isRanged = /bow|archer|ranged|crossbow|ธนู/.test(value);
    const isSpear = /spear|lance|หอก/.test(value);
    combatProfile.weaponType = isRanged ? "bow" : (isSpear ? "spear" : "sword");
    combatProfile.attackRangeTiles = isRanged ? 10 : (isSpear ? 2 : 1);
    combatProfile.moveSpeedPxPerSecond = isRanged ? 36 : (isSpear ? 34 : 40);
}

function setMonsterCombatProfile(monsterData = {}) {
    const raw = String(monsterData.attack_style || monsterData.attackStyle ||
        monsterData.monster_type || monsterData.type || (monsterData.is_boss ? "boss" : "melee")).toLowerCase();
    const isRanged = /ranged|archer|shooter|mage|caster|spitter|ธนู|เวท|พ่น/.test(raw);
    monsterCombatProfile = {
        style: isRanged ? "ranged" : "melee",
        attackRangeTiles: isRanged ? 8 : ( /boss/.test(raw) ? 2 : 1),
        moveSpeedPxPerSecond: isRanged ? 20 : (/boss/.test(raw) ? 16 : 25)
    };
}

function moveTowardX(actor, targetX, maxStep) {
    if (!actor || maxStep <= 0) return;
    const diff = targetX - actor.x;
    if (Math.abs(diff) <= maxStep) actor.x = targetX;
    else actor.x += Math.sign(diff) * maxStep;
}

function updateCombatMovement(seconds) {
    if (!gameScene || !hero || !enemy || !enemy.visible || combatPaused ||
        awaitingServerResponse || !currentMonsterId || seconds <= 0) {
        updateCombatDistanceHud();
        return;
    }
    const gapPx = Math.abs(hero.x - enemy.x);
    const gapTiles = gapPx / TILE_SIZE_PX;
    const heroRangePx = combatProfile.attackRangeTiles * TILE_SIZE_PX;
    const monsterRangePx = monsterCombatProfile.attackRangeTiles * TILE_SIZE_PX;

    // Each side moves only until it reaches its own attack range.
    if (gapTiles > combatProfile.attackRangeTiles) {
        const direction = enemy.x < hero.x ? -1 : 1;
        moveTowardX(hero, hero.x + direction * heroRangePx, combatProfile.moveSpeedPxPerSecond * seconds);
    }
    if (gapTiles > monsterCombatProfile.attackRangeTiles) {
        const direction = hero.x < enemy.x ? -1 : 1;
        moveTowardX(enemy, enemy.x + direction * monsterRangePx, monsterCombatProfile.moveSpeedPxPerSecond * seconds);
    }

    if (hero) {
        if (playerHpBarBg) playerHpBarBg.setPosition(hero.x - 22, hero.y - 28);
        if (playerHpBar) playerHpBar.setPosition(hero.x - 22, hero.y - 28);
        if (playerHpText) playerHpText.setPosition(hero.x, hero.y - 39);
    }
    updateEnemyHpBar();
    updateCombatDistanceHud();
}

// ส่งสถานะระยะไปให้ Supabase เพื่อไม่ให้ระบบต่อสู้หัก HP ก่อนตัวละครเข้าระยะ
// หมายเหตุ: ค่านี้มาจาก client; ต้องเพิ่มการยืนยันตำแหน่งฝั่ง server ก่อนใช้เป็น anti-cheat เต็มรูปแบบ
window.getCombatRangeState = function() {
    if (!hero || !enemy || !enemy.visible || combatPaused || !currentMonsterId) {
        return { playerInRange: false, monsterInRange: false };
    }
    const distanceTiles = Math.abs(hero.x - enemy.x) / TILE_SIZE_PX;
    return {
        playerInRange: distanceTiles <= combatProfile.attackRangeTiles,
        monsterInRange: distanceTiles <= monsterCombatProfile.attackRangeTiles
    };
};

function updateCombatDistanceHud() {
    const htmlHud = typeof document !== "undefined" ? document.getElementById("combat-distance") : null;
    if (!hero || !enemy || !enemy.visible) {
        if (combatDistanceText) combatDistanceText.setText("ระยะ -- ช่อง");
        if (htmlHud) htmlHud.textContent = "ระยะ -- ช่อง · รอข้อมูลมอนสเตอร์";
        return;
    }
    const tiles = Math.abs(hero.x - enemy.x) / TILE_SIZE_PX;
    const playerInRange = tiles <= combatProfile.attackRangeTiles;
    const monsterInRange = tiles <= monsterCombatProfile.attackRangeTiles;
    const label =
        "ระยะ " + tiles.toFixed(1) + "/" + ARENA_TILES + " ช่อง · " +
        (playerInRange ? "ผู้เล่นโจมตีได้" : "ผู้เล่นกำลังเข้าระยะ") + " · " +
        (monsterInRange ? "มอนสเตอร์โจมตีได้" : "มอนสเตอร์กำลังเข้าระยะ");
    if (combatDistanceText) combatDistanceText.setText(label);
    if (htmlHud) htmlHud.textContent = label;
}

function updateStageProgress(kills, stage) {
    const parsedKills = Number(kills);
    killsInStage = Math.max(0, Math.min(maxKillsPerStage,
        Number.isFinite(parsedKills) ? parsedKills : 0));
    if (stage !== undefined && stage !== null && stage !== '') currentStage = String(stage);
    const ratio = killsInStage / maxKillsPerStage;
    // Keep the server-synced counter visible inside Phaser.
    updateFarmProgressHud();
    if (stageLabelText) stageLabelText.setText(currentStage);
}
function updateFarmProgressHud() {
    if (!gameScene || !farmProgressBg || !farmProgressText || !farmProgressBarBg || !farmProgressBar) return;
    const kills = Math.max(0, Math.min(maxKillsPerStage, Number(killsInStage) || 0));
    const ratio = kills / maxKillsPerStage;
    farmProgressBg.setVisible(true);
    farmProgressText.setVisible(true).setText('⚔ ฟาร์มด่านนี้  ' + kills.toLocaleString() + ' / ' + maxKillsPerStage.toLocaleString() + ' ตัว');
    farmProgressBarBg.setVisible(true);
    farmProgressBar.setVisible(true).setSize(284 * ratio, 3);
    farmProgressBar.fillColor = ratio >= 1 ? 0x7af0a7 : 0x35d07f;
}
window.updateFarmProgressHud = updateFarmProgressHud;
window.updateStageProgress = updateStageProgress;

function spawnEnemy() {
    // ไม่สร้างมอนสเตอร์/บอสจากตัวนับฝั่ง client; ต้องรับเป้าหมายจาก Supabase ผ่าน FlutterFlow
    if (!currentMonsterId) return;
    if (killsInStage >= maxKillsPerStage) {
        combatPaused = true;
        if (enemy) enemy.setVisible(false);
        showTopNotification("ครบ 100 ตัวแล้ว! กด Challenge เพื่อสู้ด่านถัดไป");
        return;
    }
    isBossFight = currentMonsterType === "boss";
    // ใช้ HP จากเป้าหมายที่ Supabase ส่งมา ห้ามรีเซ็ตเป็นค่า mock 100
    maxEnemyHp = Math.max(1, Number(maxEnemyHp) || 1);
    enemyHp = Math.min(Math.max(1, Number(enemyHp) || maxEnemyHp), maxEnemyHp);

    if (!enemy) {
        enemy = gameScene.add.sprite(180, 165, 'enemy_normal');
        enemyHpBarBg = gameScene.add.rectangle(160, 138, 40, 6, 0x111111).setOrigin(0, 0.5).setDepth(10);
        enemyHpBar = gameScene.add.rectangle(160, 138, 40, 4, 0xe74c3c).setOrigin(0, 0.5).setDepth(11);
        enemyHpText = gameScene.add.text(180, 119, '', {
            fontSize: '9px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 3, align: 'center'
        }).setOrigin(0.5).setDepth(12);
        enemyNameText = gameScene.add.text(180, 127, '', {
            fontSize: '10px', color: '#fff', stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(12);
    }

    if (isBossFight) {
        enemy.setTexture('enemy_boss');
        enemy.setPosition(180, 155);
        enemyNameText.setText("🔥 BOSS GIGANT").setColor("#f1c40f");
        showTopNotification("⚠ WARNING! บอสประจำด่านปรากฏตัว!");
    } else {
        enemy.setTexture('enemy_normal');
        enemy.setPosition(180, 165);
        enemyNameText.setText("Slime Minion").setColor("#ffffff");
    }

    enemy.setVisible(true);
    enemy.setAlpha(1);
    updateEnemyHpBar();
}

function updateEnemyHpBar() {
    if (!gameScene || !enemy || !enemyHpBar || !enemyHpBarBg) return;
    const maxHp = Math.max(1, Number(maxEnemyHp) || 1);
    const hp = Math.max(0, Math.min(maxHp, Number(enemyHp) || 0));
    const pct = hp / maxHp;
    const barWidth = isBossFight ? 66 : 52;
    const barX = enemy.x - barWidth / 2;
    const barY = enemy.y - (isBossFight ? 43 : 35);
    enemyHpBarBg.setPosition(barX, barY).setSize(barWidth, 7).setDepth(30).setVisible(true).setAlpha(1);
    enemyHpBar.setPosition(barX, barY).setSize(Math.max(0.5, barWidth * pct), 4).setDepth(31).setVisible(true).setAlpha(1);
    enemyHpBar.fillColor = pct <= 0.25 ? 0xe74c3c : pct <= 0.5 ? 0xf1c40f : 0x2ecc71;
    if (enemyHpText) {
        enemyHpText.setPosition(enemy.x, barY - 10);
        enemyHpText.setText('HP ' + hp.toLocaleString() + ' / ' + maxHp.toLocaleString());
        enemyHpText.setFontSize(isBossFight ? '10px' : '9px');
        enemyHpText.setOrigin(0.5, 0.5).setDepth(32).setVisible(true).setAlpha(1);
    }
    if (enemyNameText) {
        enemyNameText.setPosition(enemy.x, barY - 23);
        enemyNameText.setFontSize(isBossFight ? '12px' : '10px');
        enemyNameText.setOrigin(0.5, 0.5).setDepth(33).setVisible(true).setAlpha(1);
    }
}

function performRangedAttack() {
    if (combatPaused || awaitingServerResponse || !currentMonsterId || !enemy || enemyHp <= 0 || !enemy.visible) return;

    // Keep the projectile clearly visible above the battlefield and move it from the hero to the monster.
    const distanceTiles = Math.abs(hero.x - enemy.x) / TILE_SIZE_PX;
    if (distanceTiles > combatProfile.attackRangeTiles) return;

    // The default prototype weapon is a bow; other weapon styles can be supplied by server state.
    if (combatProfile.weaponType !== "bow") {
        const slash = gameScene.add.arc((hero.x + enemy.x) / 2, hero.y - 8, 18, 205, 335, false, 0xffd166, 0.95)
            .setStrokeStyle(4, 0xffd166).setDepth(25);
        gameScene.tweens.add({ targets: slash, alpha: 0, scale: 1.3, duration: 180, onComplete: () => slash.destroy() });
        return;
    }
    const startX = hero.x - 8;
    const startY = hero.y - 8;
    const endX = enemy.x + (enemy.x < hero.x ? 8 : -8);
    const endY = enemy.y - 2;
    const arrow = gameScene.add.image(startX, startY, 'arrow_sprite')
        .setDepth(25)
        .setScale(1.15)
        .setRotation(Math.atan2(endY - startY, endX - startX));
    const trail = gameScene.add.rectangle(startX, startY, 22, 2, 0xffd166, 0.85)
        .setDepth(24)
        .setOrigin(0, 0.5)
        .setRotation(arrow.rotation);
    gameScene.tweens.add({
        targets: [arrow, trail],
        x: endX, y: endY, duration: 260, ease: "Linear",
        onComplete: () => {
            arrow.destroy();
            trail.destroy();
            createImpactSparks(enemy.x, enemy.y);
        }
    });
}

function applyDamage() {
    // Client แสดงเอฟเฟกต์เท่านั้น; HP/ความเสียหายจริงมาจาก Supabase advance_combat.
    // Recheck range at impact time in case either actor moved during the animation.
    if (combatPaused || awaitingServerResponse || !currentMonsterId || !hero || !enemy || !enemy.visible) return;
    const distanceTiles = Math.abs(hero.x - enemy.x) / TILE_SIZE_PX;
    if (distanceTiles > combatProfile.attackRangeTiles) {
        showTopNotification("ยังไม่ถึงระยะโจมตี");
        return;
    }
    createImpactSparks(enemy.x, enemy.y);
}

function updatePlayerHpBar() {
    if (!playerHpBar || !playerHpText) return;
    const maxHp = Math.max(1, Number(serverPlayerMaxHp) || 1);
    const hp = Math.max(0, Math.min(maxHp, Number(serverPlayerHp) || 0));
    const ratio = hp / maxHp;
    playerHpBar.width = 44 * ratio;
    playerHpBar.fillColor = ratio <= 0.25 ? 0xe74c3c : ratio <= 0.5 ? 0xf1c40f : 0x2ecc71;
    playerHpText.setText(`HP ${hp.toLocaleString()}/${maxHp.toLocaleString()}`);
    playerHpText.setColor(ratio <= 0.25 ? "#ff7675" : "#ffffff");
}

function animateMonsterRetaliation(damage) {
    if (!gameScene || !enemy || !hero || !enemy.visible) return;
    const amount = Math.max(0, Number(damage) || 0);
    // ภาพการโจมตีเป็นเพียงเอฟเฟกต์; ค่าความเสียหายมาจาก Supabase เท่านั้น
    const originalEnemyX = enemy.x;
    gameScene.tweens.killTweensOf(enemy);
    gameScene.tweens.add({
        targets: enemy,
        x: hero.x + (enemy.x < hero.x ? -30 : 30),
        duration: 130,
        yoyo: true,
        hold: 35,
        ease: "Sine.easeInOut",
        onYoyo: () => {
            gameScene.cameras.main.shake(90, 0.003);
            gameScene.tweens.add({
                targets: hero, x: hero.x + 4, duration: 55, yoyo: true,
                onStart: () => hero.setTint(0xff7777),
                onComplete: () => hero.clearTint()
            });
        },
        onComplete: () => { if (enemy) enemy.x = originalEnemyX; updateEnemyHpBar(); updateCombatDistanceHud(); }
    });
    if (amount > 0) {
        const hit = gameScene.add.text(hero.x, hero.y - 30, "-" + amount, {
            fontSize: "13px", fontStyle: "bold", color: "#ff5b5b",
            stroke: "#000000", strokeThickness: 3
        }).setOrigin(0.5).setDepth(20);
        gameScene.tweens.add({
            targets: hit, y: hit.y - 18, alpha: 0, duration: 650,
            onComplete: () => hit.destroy()
        });
    }
}

window.onServerCombatUpdate = function(payload) {
    let state;
    try { state = typeof payload === "string" ? JSON.parse(payload) : payload; }
    catch (err) { console.error("Invalid server combat update", err); return; }
    if (!state || state.success !== true) return;

    // Fallback: combat RPC may be active even when get_current_combat_target returns no row.
    // Build a visible Phaser target from the authoritative combat payload when it includes a monster ID.
    const combatMonsterId = state.monster_id ?? state.monsterId ?? state.target_id ?? state.targetId ?? null;
    const combatMonsterName = state.monster_name ?? state.monsterName ?? state.target_name ?? state.targetName ?? null;
    if ((state.status === "fighting" || state.status === "monster_defeated") &&
        combatMonsterId != null && gameScene) {
        // Ensure Phaser target objects exist even if the initial target query returned no row.
        const combatType = String(state.monster_type || (state.is_boss ? "boss" : "normal")).toLowerCase();
        const combatIsBoss = Boolean(state.is_boss ?? combatType === "boss");
        setMonsterCombatProfile({ monster_type: combatType, is_boss: combatIsBoss, attack_style: state.attack_style || state.attackStyle });
        if (!enemy) enemy = gameScene.add.sprite(180, combatIsBoss ? 155 : 165, combatIsBoss ? "enemy_boss" : "enemy_normal");
        if (!enemyNameText) enemyNameText = gameScene.add.text(0, 0, "", { fontSize: "10px", color: "#ffffff", fontStyle: "bold", stroke: "#000000", strokeThickness: 3, backgroundColor: "#000000aa", padding: { x: 3, y: 2 } }).setOrigin(0.5);
        if (!enemyHpText) enemyHpText = gameScene.add.text(0, 0, "", { fontSize: "9px", color: "#ffffff", fontStyle: "bold", stroke: "#000000", strokeThickness: 3, backgroundColor: "#000000aa", padding: { x: 3, y: 2 } }).setOrigin(0.5);
        if (!enemyHpBarBg) enemyHpBarBg = gameScene.add.rectangle(0, 0, 64, 7, 0x111111).setOrigin(0.5);
        if (!enemyHpBar) enemyHpBar = gameScene.add.rectangle(0, 0, 60, 5, 0xe74c3c).setOrigin(0.5);
        const changedTarget = String(combatMonsterId) !== String(currentMonsterId ?? "");
        currentMonsterId = String(combatMonsterId);
        if (combatMonsterName) enemyNameText.setText(String(combatMonsterName));
        if (state.monster_type || state.is_boss != null) {
            currentMonsterType = String(state.monster_type || (state.is_boss ? "boss" : "normal")).toLowerCase();
            isBossFight = Boolean(state.is_boss ?? currentMonsterType === "boss");
            enemy.setTexture(isBossFight ? "enemy_boss" : "enemy_normal");
        }
        if (changedTarget) enemy.setPosition(MONSTER_START_X, isBossFight ? 155 : 165);
        else enemy.setY(isBossFight ? 155 : 165);
        enemy.setDepth(15).setVisible(true).setAlpha(1);
        enemyNameText.setVisible(true).setAlpha(1).setDepth(33);
        enemyHpText.setVisible(true).setAlpha(1).setDepth(32);
        enemyHpBarBg.setVisible(true).setAlpha(1).setDepth(30);
        enemyHpBar.setVisible(true).setAlpha(1).setDepth(31);
        if (changedTarget) {
            lastDisplayedMonsterHp = null;
            lastDisplayedMonsterId = currentMonsterId;
        }
        if (state.monster_hp != null) enemyHp = Math.max(0, Number(state.monster_hp) || 0);
        if (state.monster_max_hp != null) maxEnemyHp = Math.max(1, Number(state.monster_max_hp) || 1);
        updateEnemyHpBar();

        // A target can arrive from advance_combat after the initial load had no target.
        // Start ranged attacks here too, not only in initGameState().
        if (currentMonsterId) {
            combatPaused = false;
            if (!isGameRunning) {
                combatTimer = gameScene.time.addEvent({
                    delay: 1100,
                    callback: performRangedAttack,
                    callbackScope: gameScene,
                    loop: true
                });
                isGameRunning = true;
            }
        }
    }

    const previousStatus = lastServerCombatStatus;
    const previousHp = lastDisplayedPlayerHp ?? serverPlayerHp;
    const incomingMonsterId = state.monster_id != null ? String(state.monster_id) : currentMonsterId;
    const changedMonster = !!incomingMonsterId && incomingMonsterId !== lastDisplayedMonsterId;
    const previousMonsterHp = lastDisplayedMonsterHp;
    lastServerCombatStatus = state.status || "fighting";
    serverPlayerHp = Number(state.player_hp ?? serverPlayerHp);
    serverPlayerMaxHp = Number(state.player_max_hp ?? serverPlayerMaxHp);
    if (incomingMonsterId) currentMonsterId = incomingMonsterId;
    if (changedMonster) {
        lastDisplayedMonsterHp = null;
        lastDisplayedMonsterId = incomingMonsterId;
    }

    updatePlayerHpBar();
    if (lastDisplayedPlayerHp !== null && serverPlayerHp < previousHp) {
        animateMonsterRetaliation(previousHp - serverPlayerHp);
    }
    lastDisplayedPlayerHp = serverPlayerHp;

    // แสดงตัวเลขดาเมจจากผลต่าง HP ที่ Supabase ยืนยัน รวมถึงจังหวะที่มอนสเตอร์ตายพอดี
    if ((state.status === "fighting" || state.status === "monster_defeated") &&
        state.monster_hp != null && state.monster_max_hp != null) {
        maxEnemyHp = Math.max(1, Number(state.monster_max_hp));
        enemyHp = Math.max(0, Math.min(maxEnemyHp, Number(state.monster_hp)));
        if (enemy && !enemy.visible && currentMonsterId) enemy.setVisible(true);
        updateEnemyHpBar();
        if (!changedMonster && previousMonsterHp != null && enemyHp < previousMonsterHp) {
            showDamageText(enemy ? enemy.x : 180, enemy ? enemy.y - 20 : 145, previousMonsterHp - enemyHp, false);
            createImpactSparks(enemy ? enemy.x : 180, enemy ? enemy.y : 165);
            if (enemy) {
                gameScene.tweens.killTweensOf(enemy);
                const originalX = enemy.x;
                gameScene.tweens.add({ targets: enemy, x: originalX - 5, duration: 45, yoyo: true, repeat: 1 });
                enemy.setTint(0xffdddd);
                gameScene.time.delayedCall(120, () => { if (enemy) enemy.clearTint(); });
            }
        }
        lastDisplayedMonsterHp = enemyHp;
        lastDisplayedMonsterId = currentMonsterId;
    }

    if (state.status === "dead") {
        combatPaused = true;
        if (hero && previousStatus !== "dead") {
            gameScene.tweens.killTweensOf(hero);
            hero.clearTint();
            gameScene.tweens.add({ targets: hero, alpha: 0.25, y: hero.y + 5, duration: 180, yoyo: true, repeat: 2 });
            showTopNotification("คุณถูกมอนสเตอร์โค่น! กำลังเกิดใหม่...");
        }
        if (enemy) {
            enemyHp = Math.max(1, Number(state.monster_max_hp ?? maxEnemyHp));
            maxEnemyHp = enemyHp;
            updateEnemyHpBar();
        }
    } else if (state.status === "fighting") {
        const wasDead = previousStatus === "dead";
        if (state.monster_hp != null && state.monster_max_hp != null) {
            maxEnemyHp = Math.max(1, Number(state.monster_max_hp));
            enemyHp = Math.max(0, Math.min(maxEnemyHp, Number(state.monster_hp)));
            updateEnemyHpBar();
        }
        combatPaused = false;
        if (hero && wasDead) {
            gameScene.tweens.killTweensOf(hero);
            hero.setAlpha(1);
            hero.clearTint();
            // Respawn at the designated player spawn point, not where the player died.
            hero.setPosition(PLAYER_START_X, 165);
            if (pet) pet.setPosition(hero.x + 30, 170);
            showTopNotification("เกิดใหม่แล้ว! กลับจุดเกิดและสุ่มมอนสเตอร์ใหม่ในด่านเดิม");
            updateCombatDistanceHud();
        }
    } else if (state.status === "no_target") {
        combatPaused = true;
    } else if (state.status === "monster_defeated") {
        combatPaused = true;
        if (state.reward) showConfirmedRewards(state.reward);
        if (state.state) window.initGameState(JSON.stringify(state.state));
    }

    if (typeof document !== "undefined") {
        const hint = document.getElementById("combat-hint");
        if (hint) {
            const playerLine = "HP ผู้เล่น " + serverPlayerHp.toLocaleString() + "/" + serverPlayerMaxHp.toLocaleString();
            if (state.status === "dead") hint.textContent = playerLine + " · ตายแล้ว · กำลังรอเกิดใหม่ · หลังเกิดใหม่จะสุ่มมอนสเตอร์ใหม่ในด่านเดิม";
            else if (state.status === "fighting") hint.textContent = playerLine + " · HP มอนสเตอร์ " + enemyHp.toLocaleString() + "/" + maxEnemyHp.toLocaleString() + " · ผลคำนวณจาก Supabase";
            else if (state.status === "no_target") hint.textContent = playerLine + " · รอเป้าหมายต่อสู้จากเซิร์ฟเวอร์";
        }
    }
};

function createImpactSparks(x, y) {
    for (let i = 0; i < 5; i++) {
        const spark = gameScene.add.sprite(x, y, 'spark_particle');
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 25 + 10;
        gameScene.tweens.add({
            targets: spark, x: x + Math.cos(angle) * speed, y: y + Math.sin(angle) * speed, alpha: 0, duration: 200,
            onComplete: () => spark.destroy()
        });
    }
}

function showDamageText(x, y, damage, isCrit) {
    const txt = gameScene.add.text(x, y, isCrit ? `CRIT ${damage}` : `${damage}`, {
        fontSize: isCrit ? '16px' : '12px', fontStyle: 'bold',
        color: isCrit ? '#ff4757' : '#ffffff', stroke: '#000000', strokeThickness: 2
    }).setOrigin(0.5);

    gameScene.tweens.add({
        targets: txt, y: y - 25, alpha: 0, duration: 600,
        onComplete: () => txt.destroy()
    });
}

function onEnemyKilled() {
    if (awaitingServerResponse || !currentMonsterId) return;

    // ล็อกคำขอหนึ่งครั้งต่อการตาย ป้องกันการส่งซ้ำจากลูกศร/ท่าไม้ตายที่กำลังเล่นอยู่
    const killedMonsterId = currentMonsterId;
    const requestId = `kill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    pendingKillRequestId = requestId;
    pendingKilledMonsterId = killedMonsterId;
    combatPaused = true;
    awaitingServerResponse = true;

    // เอฟเฟกต์ตายและฮีโร่วิ่งต่อได้ทันที แต่ยังไม่แสดงรางวัลจนกว่าเซิร์ฟเวอร์ยืนยัน
    const deadX = enemy.x;
    const deadY = enemy.y;
    createImpactSparks(deadX, deadY);
    gameScene.tweens.add({
        targets: enemy, alpha: 0, scale: 0.65, duration: 220,
        onComplete: () => enemy.setVisible(false)
    });
    gameScene.tweens.add({
        targets: hero, x: 315, duration: 360, ease: "Sine.easeInOut"
    });
    showTopNotification("กำลังยืนยันผลการต่อสู้...");

    sendToFlutterFlow({
        event: "MONSTER_KILL_REQUEST",
        requestId,
        monsterId: killedMonsterId,
        stage: currentStage,
        isChallengeTarget
    });
}

function triggerStageClearEffect() {
    // ใช้เฉพาะเอฟเฟกต์ภาพเมื่อ FlutterFlow แจ้งว่าผ่าน Challenge แล้ว
    const clearText = gameScene.add.text(260, 110, '🎉 CHALLENGE CLEAR! 🎉', {
        fontSize: '24px', fontStyle: 'bold', color: '#f1c40f', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setScale(0);
    gameScene.tweens.add({
        targets: clearText, scale: 1.1, duration: 400, yoyo: true, hold: 500,
        onComplete: () => clearText.destroy()
    });
}

function spawnEquipmentDrop(x, y) {
    const sword = gameScene.add.sprite(x, y, 'item_sword');
    gameScene.tweens.add({
        targets: sword, y: y - 20, x: x - 20, duration: 300, yoyo: true,
        onComplete: () => {
            gameScene.tweens.add({
                targets: sword, alpha: 0, duration: 500,
                onComplete: () => sword.destroy()
            });
        }
    });
    // อุปกรณ์จริงต้องมาจากผล RPC ไม่สุ่มรางวัลใน client
}

function spawnCoinBurst(x, y) {
    for (let i = 0; i < 4; i++) {
        const coin = gameScene.add.sprite(x, y, 'coin_sprite');
        gameScene.tweens.add({
            targets: coin, x: x + (Math.random() - 0.5) * 30, y: y - 15, duration: 250, yoyo: true,
            onComplete: () => coin.destroy()
        });
    }
}

function showLootChestAnimation(x, y) {
    const chest = gameScene.add.sprite(x, y - 10, 'chest_sprite');
    gameScene.tweens.add({
        targets: chest, y: y - 35, alpha: 0, duration: 800,
        onComplete: () => chest.destroy()
    });
}

function showTopNotification(text) {
    if (!topBanner || !topBannerText) return;
    topBannerText.setText(text);
    gameScene.tweens.add({
        targets: [topBanner, topBannerText], y: 20, duration: 200, hold: 1200, yoyo: true
    });
}
// เก็บ request ที่ตอบกลับแล้ว เพื่อไม่ให้ response ซ้ำแสดงรางวัลซ้ำ
let pendingKillRequestId = null;
let pendingKilledMonsterId = null;
const resolvedKillRequests = new Set();

function showConfirmedRewards(reward) {
    if (!gameScene || !reward) return;
    const gold = Number(reward.gold_gain ?? reward.goldGain ?? 0) || 0;
    const exp = Number(reward.exp_gain ?? reward.expGain ?? 0) || 0;
    const materialQty = Number(reward.material_quantity ?? reward.materialQuantity ?? 0) || 0;
    const materialId = reward.material_id ?? reward.materialId ?? null;

    if (gold > 0) spawnCoinBurst(enemy ? enemy.x : 180, enemy ? enemy.y : 155);
    const rewardLines = [];
    if (gold > 0) rewardLines.push(`+${gold} Gold`);
    if (exp > 0) rewardLines.push(`+${exp} EXP`);
    if (materialQty > 0 && materialId) rewardLines.push(`💎 ${materialId} x${materialQty}`);

    if (rewardLines.length) {
        const label = gameScene.add.text(260, 75, rewardLines.join("   "), {
            fontSize: "12px", fontStyle: "bold", color: "#f1c40f",
            stroke: "#000000", strokeThickness: 3, align: "center",
            backgroundColor: "#00000099", padding: { x: 6, y: 4 }
        }).setOrigin(0.5);
        gameScene.tweens.add({
            targets: label, y: 48, alpha: 0, duration: 1200, delay: 250,
            onComplete: () => label.destroy()
        });
    }

    // อัปเดตกระเป๋าตัวอย่างเฉพาะเมื่อผล RPC ยืนยันว่ามีวัสดุตกจริง
    if (materialQty > 0 && materialId && typeof addLootToInventoryUI === "function") {
        addLootToInventoryUI("💎", `${materialId} x${materialQty}`);
    }
}

// ==========================================
// 7. Initial State Sync (รับข้อมูลก้อนแรกตอนเริ่มเกม)
// ==========================================
let isGameRunning = false;

// FlutterFlow เรียกฟังก์ชันนี้หลัง RPC สำเร็จ โดยส่งสถานะและเป้าหมายล่าสุดจาก Supabase
window.initGameState = function(jsonPayload) {
    let state;
    try {
        state = typeof jsonPayload === 'string' ? JSON.parse(jsonPayload) : jsonPayload;
    } catch (err) {
        console.error("Invalid game state JSON", err);
        return;
    }
    if (!gameScene || !state || typeof state !== "object") {
        console.error("Game scene or valid server state is missing", state);
        return;
    }

    console.log("🎮 Server state received:", state);
    const playerData = state.player || state.profile || {};
    const mapData = state.map || {};
    setPlayerCombatProfile(playerData);
    if (mapData.theme) changeMapTheme(mapData.theme);

    const status = state.stageStatus || state.stage_status || state.stage_status_data || {};
    const stageNum = status.current_farm_stage ?? status.currentFarmStage ?? mapData.stageId ?? state.stage ?? currentStage;
    currentStage = String(stageNum);
    if (stageLabelText) stageLabelText.setText(currentStage);
    changePetSkin(playerData.pet || playerData.active_pet_skin || "none");

    updateStageProgress(
        status.kills_in_stage ?? status.killsInStage ?? state.killsInStage ?? killsInStage,
        stageNum
    );

    const monster = state.monster || state.target || state.current_target || state.currentTarget || state.combat?.monster || null;
    awaitingServerResponse = false;
    if (!monster) {
        currentMonsterId = null;
        combatPaused = true;
        if (enemy) enemy.setVisible(false);
        if (enemyNameText) enemyNameText.setVisible(false);
        if (enemyHpText) enemyHpText.setVisible(false);
        if (enemyHpBarBg) enemyHpBarBg.setVisible(false);
        if (enemyHpBar) enemyHpBar.setVisible(false);
        if (status.challenge_ready || status.challengeReady || killsInStage >= maxKillsPerStage) {
            showTopNotification("ครบ 100 ตัวแล้ว! กด Challenge เพื่อท้าทายด่านถัดไป");
        } else if (state.error) {
            showTopNotification("โหลดเป้าหมายไม่สำเร็จ กรุณาลองใหม่");
        }
        return;
    }

    // Show the server-provided monster even if its identifier is absent; attacks remain disabled until an ID arrives.
    const monsterId = monster.id ?? monster.monster_id ?? monster.monsterId ?? monster.target_id ?? monster.targetId ?? null;
    currentMonsterId = monsterId == null ? null : String(monsterId);
    currentMonsterType = String(monster.monster_type || monster.type || (monster.is_boss ? "boss" : "normal")).toLowerCase();
    isBossFight = Boolean(monster.is_boss ?? monster.isBoss ?? (currentMonsterType === "boss"));
    setMonsterCombatProfile(monster);
    isChallengeTarget = Boolean(monster.is_challenge ?? monster.isChallenge ?? false);
    // Keep current HP separate from max HP; Supabase payloads may provide either naming style.
    maxEnemyHp = Math.max(1, Number(monster.monster_max_hp ?? monster.max_hp ?? monster.maxHp ?? monster.max_hp_total ?? monster.monster_hp ?? 100) || 100);
    enemyHp = Math.max(0, Math.min(maxEnemyHp, Number(monster.current_hp ?? monster.currentHp ?? monster.hp ?? monster.monster_hp ?? maxEnemyHp)));

    if (!enemy) enemy = gameScene.add.sprite(180, 165, isBossFight ? 'enemy_boss' : 'enemy_normal');
    enemy.setTexture(isBossFight ? 'enemy_boss' : 'enemy_normal');
    enemy.setPosition(MONSTER_START_X, isBossFight ? 155 : 165);
    enemy.setScale(isBossFight ? 1 : 1);
    enemy.setDepth(15).setVisible(true).setAlpha(1);
    enemyNameText.setText(String(monster.monster_name || monster.monsterName || monster.name || monster.display_name || monster.displayName || "Monster"));
    enemyNameText.setColor(isBossFight ? "#f1c40f" : "#ffffff");
    enemyNameText.setVisible(true).setAlpha(1).setDepth(33);
    enemyHpText.setVisible(true).setAlpha(1).setDepth(32);
    enemyHpBarBg.setVisible(true).setAlpha(1).setDepth(30);
    enemyHpBar.setVisible(true).setAlpha(1).setDepth(31);
    lastDisplayedMonsterHp = null;
    lastDisplayedMonsterId = currentMonsterId;
    updateEnemyHpBar();

    // เล่นวิ่งเข้าหาศัตรูใหม่เฉพาะหลังได้ state ที่เซิร์ฟเวอร์ยืนยันแล้ว
    if (hero) {
        gameScene.tweens.add({ targets: hero, x: PLAYER_START_X, duration: 260, ease: "Sine.easeOut" });
    }
    gameScene.tweens.add({
        targets: enemy, x: MONSTER_START_X, duration: 260, ease: "Sine.easeOut",
        onUpdate: () => {
            updateEnemyHpBar();
        }
    });
    combatPaused = !currentMonsterId;
    if (!currentMonsterId) showTopNotification("ได้รับข้อมูลมอนสเตอร์แล้ว แต่ยังไม่มี ID สำหรับต่อสู้");

    if (!isGameRunning && currentMonsterId) {
        combatTimer = gameScene.time.addEvent({ delay: 1100, callback: performRangedAttack, callbackScope: gameScene, loop: true });
        isGameRunning = true;
    }
};

// FlutterFlow ต้องส่งผล RPC กลับเข้ามาที่ callback นี้หลังตรวจสอบสำเร็จ
window.onFlutterFlowResponse = function(jsonPayload) {
    let response;
    try {
        response = typeof jsonPayload === "string" ? JSON.parse(jsonPayload) : jsonPayload;
    } catch (err) {
        console.error("Invalid FlutterFlow response", err);
        return;
    }
    if (!response) return;

    if (response.event === "MONSTER_KILL_RESULT") {
        // ต้องเป็นคำขอที่กำลังรออยู่ และยังไม่เคยประมวลผล response นี้
        const responseRequestId = response.requestId || response.request_id || null;
        if (!pendingKillRequestId || responseRequestId !== pendingKillRequestId) {
            console.warn("Ignored duplicate or stale kill response", responseRequestId);
            return;
        }
        if (resolvedKillRequests.has(pendingKillRequestId)) {
            console.warn("Ignored duplicate kill result", pendingKillRequestId);
            return;
        }

        if (response.success !== true) {
            pendingKillRequestId = null;
            pendingKilledMonsterId = null;
            awaitingServerResponse = false;
            combatPaused = true;
            // การปฏิเสธจากเซิร์ฟเวอร์ไม่ใช่การฆ่ามอนสเตอร์: คืน HP ให้ตรงกับ HP จริงจาก Supabase
            enemyHp = maxEnemyHp;
            if (enemy) {
                // ยกเลิก tween การตายที่อาจซ่อนมอนสเตอร์หลัง RPC ปฏิเสธคำขอ
                gameScene.tweens.killTweensOf(enemy);
                enemy.setVisible(true);
                enemy.setAlpha(1);
                enemy.setScale(1);
            }
            if (hero) {
                gameScene.tweens.killTweensOf(hero);
                hero.setX(PLAYER_START_X);
            }
            updateEnemyHpBar();
            const serverMessage = response.message || "เซิร์ฟเวอร์ไม่ยืนยันการกำจัดมอนสเตอร์";
            const powerTooLow = /COMBAT_POWER_TOO_LOW|พลังโจมตีไม่พอ/i.test(serverMessage);
            showTopNotification(powerTooLow ? "พลังโจมตีไม่พอ! อัปเกรดก่อน" : serverMessage);
            if (typeof document !== "undefined") {
                const hint = document.getElementById("combat-hint");
                if (hint) hint.textContent = powerTooLow
                    ? "พลังโจมตีไม่ถึงเกณฑ์ของมอนสเตอร์ระดับด่านนี้ · ไม่มีการให้รางวัล · อัปเกรดพลังโจมตี/เลเวลแล้วกดโหลดสถานะจากเซิร์ฟเวอร์"
                    : serverMessage + " · ไม่มีการให้รางวัลจนกว่าเซิร์ฟเวอร์จะยืนยัน";
            }
            return;
        }

        resolvedKillRequests.add(pendingKillRequestId);
        // RPC ปัจจุบันคืน reward fields ที่ระดับบนสุด; รองรับกรณี FlutterFlow ห่อไว้ใน reward/result
        const reward = response.reward || response.result || response;
        showConfirmedRewards(reward);

        pendingKillRequestId = null;
        pendingKilledMonsterId = null;

        if (response.state) {
            // state ควรรวม monster ตัวถัดไปจาก get_current_combat_target() ด้วย
            window.initGameState(response.state);
        } else {
            awaitingServerResponse = false;
            combatPaused = true;
            if (hero) hero.setX(PLAYER_START_X);
            showTopNotification("บันทึกรางวัลแล้ว แต่ยังไม่ได้รับมอนสเตอร์ตัวถัดไป");
        }
    } else if (response.event === "CHALLENGE_RESULT" && response.success === false) {
        awaitingServerResponse = false;
        combatPaused = true;
        showTopNotification(response.message || "ยังไม่สามารถ Challenge ได้");
    } else if ((response.event === "CHALLENGE_RESULT" || response.event === "STAGE_CLEARED") && response.success !== false) {
        triggerStageClearEffect();
        if (response.state) window.initGameState(response.state);
    }
};
