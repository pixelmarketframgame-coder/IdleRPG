// ==========================================
// Global Variables & Scene Reference
// ==========================================
let gameScene = null; // เก็บ Reference ตัวเกมให้ HTML เรียกใช้ได้ตลอดเวลา

let bgFar, bgMid, bgFloor;
let hero, pet, enemy, portal;
let enemyHp = 100, maxEnemyHp = 100;
let enemyHpBar, enemyNameText, topBanner, topBannerText, stageProgressBar;

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
    if (!gameScene || !enemy || combatPaused || awaitingServerResponse || !currentMonsterId) return;
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
    g.fillStyle(0xf39c12); g.fillRect(0, 2, 12, 2); g.generateTexture('arrow_sprite', 14, 6); g.clear();
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

    hero = this.add.sprite(390, 165, 'hero_sprite');
    pet = this.add.sprite(430, 170, 'pet_slime');
    pet.setVisible(false); // ซ่อนสัตว์เลี้ยงตอนเริ่มเกม

    // ❌ ลบบรรทัด spawnEnemy(); ออกไปเลยครับ

    topBanner = this.add.rectangle(260, -30, 340, 24, 0x000000, 0.85).setStrokeStyle(1, 0x555555);
    topBannerText = this.add.text(260, -30, '', { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5);

    this.add.rectangle(450, 205, 80, 8, 0x2d3436);
    stageProgressBar = this.add.rectangle(410, 205, 0, 6, 0xe74c3c).setOrigin(0, 0.5);
    this.add.text(495, 205, '👹', { fontSize: '10px' }).setOrigin(0.5);

    // ❌ ลบบรรทัด this.time.addEvent(...) ที่เป็นลูปโจมตีออกไปด้วยครับ
}

function update() {
    if (bgFar) bgFar.tilePositionX += 0.1;
    if (bgMid) bgMid.tilePositionX += 0.4;
    if (bgFloor) bgFloor.tilePositionX += 1.2;
    if (pet) pet.y = 170 + Math.sin(this.time.now / 200) * 2;
}

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
    enemyHp = maxEnemyHp = 100;

    if (!enemy) {
        enemy = gameScene.add.sprite(180, 165, 'enemy_normal');
        gameScene.add.rectangle(180, 138, 42, 5, 0x000000);
        enemyHpBar = gameScene.add.rectangle(180, 138, 40, 3, 0xe74c3c);
        enemyNameText = gameScene.add.text(180, 126, '', { fontSize: '10px', color: '#fff' }).setOrigin(0.5);
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
    if (!enemyHpBar) return;
    const pct = Math.max(0, enemyHp / maxEnemyHp);
    enemyHpBar.width = 40 * pct;
}

function performRangedAttack() {
    if (combatPaused || awaitingServerResponse || !currentMonsterId || !enemy || enemyHp <= 0 || !enemy.visible) return;

    const arrow = gameScene.add.sprite(hero.x - 10, hero.y - 5, 'arrow_sprite');
    gameScene.tweens.add({
        targets: arrow, x: enemy.x + 10, y: enemy.y, duration: 160,
        onComplete: () => { arrow.destroy(); applyDamage(); }
    });
}

function applyDamage() {
    if (combatPaused || awaitingServerResponse || !currentMonsterId || !enemy || enemyHp <= 0) return;

    const isCrit = Math.random() < 0.3;
    const damage = isCrit ? Math.floor(Math.random() * 25) + 35 : Math.floor(Math.random() * 10) + 15;

    enemyHp -= damage;
    updateEnemyHpBar();

    if (isCrit || isBossFight) gameScene.cameras.main.shake(120, isBossFight ? 0.008 : 0.004);

    createImpactSparks(enemy.x, enemy.y);
    showDamageText(enemy.x, enemy.y - 20, damage, isCrit);

    if (enemyHp <= 0) onEnemyKilled();
}

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

    combatPaused = true;
    awaitingServerResponse = true;
    enemy.setVisible(false);
    createImpactSparks(enemy.x, enemy.y);

    // รางวัลและความคืบหน้าต้องมาจาก RPC; ห้ามเชื่อ reward ที่คำนวณใน client
    sendToFlutterFlow({
        event: "MONSTER_KILL_REQUEST",
        monsterId: currentMonsterId,
        stage: currentStage,
        isChallengeTarget: isChallengeTarget
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
    if (!gameScene || !state || !state.player || !state.map) {
        console.error("Game scene or required state is missing");
        return;
    }

    console.log("🎮 Server state received:", state);
    if (state.map.theme) changeMapTheme(state.map.theme);

    const status = state.stageStatus || state.stage_status || {};
    const stageNum = status.current_farm_stage ?? status.currentFarmStage ?? state.map.stageId ?? currentStage;
    currentStage = String(stageNum);
    if (stageLabelText) stageLabelText.setText(currentStage);
    changePetSkin(state.player.pet || state.player.active_pet_skin || "none");

    killsInStage = Number(status.kills_in_stage ?? status.killsInStage ?? state.killsInStage ?? killsInStage) || 0;
    if (stageProgressBar) stageProgressBar.width = 80 * Math.min(1, killsInStage / maxKillsPerStage);

    const monster = state.monster || state.target || null;
    awaitingServerResponse = false;
    if (!monster || !(monster.id || monster.monster_id || monster.monsterId)) {
        currentMonsterId = null;
        combatPaused = true;
        if (enemy) enemy.setVisible(false);
        if (status.challenge_ready || status.challengeReady || killsInStage >= maxKillsPerStage) {
            showTopNotification("ครบ 100 ตัวแล้ว! กด Challenge เพื่อท้าทายด่านถัดไป");
        } else if (state.error) {
            showTopNotification("โหลดเป้าหมายไม่สำเร็จ กรุณาลองใหม่");
        }
        return;
    }

    currentMonsterId = String(monster.id || monster.monster_id || monster.monsterId);
    currentMonsterType = String(monster.monster_type || monster.type || (monster.is_boss ? "boss" : "normal")).toLowerCase();
    isBossFight = Boolean(monster.is_boss ?? monster.isBoss ?? (currentMonsterType === "boss"));
    isChallengeTarget = Boolean(monster.is_challenge ?? monster.isChallenge ?? false);
    maxEnemyHp = Number(monster.monster_hp ?? monster.maxHp ?? monster.max_hp ?? 100) || 100;
    enemyHp = Number(monster.current_hp ?? monster.currentHp ?? maxEnemyHp) || maxEnemyHp;

    if (!enemy) {
        enemy = gameScene.add.sprite(180, 165, isBossFight ? 'enemy_boss' : 'enemy_normal');
        gameScene.add.rectangle(180, 138, 42, 5, 0x000000);
        enemyHpBar = gameScene.add.rectangle(180, 138, 40, 3, 0xe74c3c);
        enemyNameText = gameScene.add.text(180, 126, '', { fontSize: '10px', color: '#fff' }).setOrigin(0.5);
    }
    enemy.setTexture(isBossFight ? 'enemy_boss' : 'enemy_normal');
    enemy.setPosition(180, isBossFight ? 155 : 165);
    enemyNameText.setText(monster.monster_name || monster.name || "Monster");
    enemyNameText.setColor(isBossFight ? "#f1c40f" : "#ffffff");
    enemy.setVisible(true);
    enemy.setAlpha(1);
    updateEnemyHpBar();
    combatPaused = false;

    if (!isGameRunning) {
        combatTimer = gameScene.time.addEvent({ delay: 1100, callback: performRangedAttack, callbackScope: gameScene, loop: true });
        isGameRunning = true;
    }
};

// Optional acknowledgement/error callback for FlutterFlow WebView JavaScript calls
window.onFlutterFlowResponse = function(jsonPayload) {
    let response;
    try {
        response = typeof jsonPayload === 'string' ? JSON.parse(jsonPayload) : jsonPayload;
    } catch (err) {
        console.error("Invalid FlutterFlow response", err);
        return;
    }
    if (!response) return;
    if (response.event === "MONSTER_KILL_RESULT" && response.success === false) {
        awaitingServerResponse = false;
        combatPaused = true;
        showTopNotification(response.message || "บันทึกผลการต่อสู้ไม่สำเร็จ");
    } else if (response.event === "CHALLENGE_RESULT" && response.success === false) {
        awaitingServerResponse = false;
        combatPaused = true;
        showTopNotification(response.message || "ยังไม่สามารถ Challenge ได้");
    } else if ((response.event === "CHALLENGE_RESULT" || response.event === "STAGE_CLEARED") && response.success !== false) {
        triggerStageClearEffect();
        if (response.state) window.initGameState(response.state);
    } else if (response.event === "MONSTER_KILL_RESULT" && response.success === true && response.state) {
        window.initGameState(response.state);
    }
};
