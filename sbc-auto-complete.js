// Paletools SBC Auto Completer + Pack Opener
// يكمل SBCs تلقائياً ويفتح البكجات مع إدارة اللاعبين المكررين

(function () {
    'use strict';

    // ========== الإعدادات ==========
    const CONFIG = {
        // وقت الانتظار بين العمليات
        WAIT_TIME: 2000,
        CLICK_DELAY: 500,

        // إدارة اللاعبين المكررين
        GOLD_DUPLICATES_TO_SBC_STORAGE: true,  // الذهبيين المكررين → SBC Storage
        BRONZE_SILVER_QUICK_SELL: true,        // البرونز والفضيين → Quick Sell

        // إيقاف تلقائي عند امتلاء SBC Storage
        STOP_ON_SBC_STORAGE_FULL: true,

        // عدد البكجات المراد فتحها بعد كل SBC (-1 = كل البكجات المتاحة)
        PACKS_PER_SBC: 1
    };

    // ========== المتغيرات ==========
    let isRunning = false;
    let sbcsCompleted = 0;
    let packsOpened = 0;
    let goldsSentToStorage = 0;
    let quickSells = 0;
    let currentSBC = null;
    let sbcList = [];

    // ========== الدوال المساعدة ==========
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function clickElement(selector, maxRetries = 5) {
        for (let i = 0; i < maxRetries; i++) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (element && element.offsetParent !== null) {
                    element.click();
                    console.log(`✅ Clicked: ${selector}`);
                    await wait(CONFIG.CLICK_DELAY);
                    return true;
                }
            }
            await wait(300);
        }
        console.log(`❌ Failed to click: ${selector}`);
        return false;
    }

    async function waitForElement(selector, timeout = 10000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) {
                return element;
            }
            await wait(200);
        }
        return null;
    }

    function findElementByText(text, tag = '*') {
        const elements = document.querySelectorAll(tag);
        for (const el of elements) {
            if (el.textContent.trim().includes(text)) {
                return el;
            }
        }
        return null;
    }

    // ========== التنقل إلى SBC ==========
    async function goToSBCSection() {
        log('📍 الانتقال إلى قسم SBC...');

        // Try different selectors for SBC navigation
        const sbcSelectors = [
            'button.ut-tab-bar-item.icon-sbc',
            'a[href*="sbc"]',
            'button[class*="sbc"]',
            '.ut-navigation-button-control:contains("SBC")',
            '.icon-sbc'
        ];

        for (const selector of sbcSelectors) {
            if (await clickElement(selector)) {
                await wait(CONFIG.WAIT_TIME);
                log('✅ تم الانتقال إلى SBC');
                return true;
            }
        }

        log('❌ فشل الوصول إلى قسم SBC');
        return false;
    }

    // ========== الحصول على قائمة SBCs المتاحة ==========
    async function getSBCList() {
        log('📋 جاري تحميل قائمة SBCs...');

        await wait(1500);

        const sbcTiles = document.querySelectorAll('.ut-tile-transfer-market, .ut-sbc-set-tile, .sbc-tile, [class*="sbc"][class*="tile"]');

        sbcList = [];
        sbcTiles.forEach((tile, index) => {
            const name = tile.querySelector('.title, .ut-tile-content-title, h2, h3')?.textContent.trim() || `SBC ${index + 1}`;
            const isCompleted = tile.querySelector('.completed, .checkmark, [class*="complete"]');

            if (!isCompleted) {
                sbcList.push({
                    element: tile,
                    name: name,
                    index: sbcList.length
                });
            }
        });

        log(`📊 تم العثور على ${sbcList.length} SBC متاح`);
        return sbcList;
    }

    // ========== اختيار وفتح SBC ==========
    async function selectAndOpenSBC(sbcIndex) {
        if (!sbcList[sbcIndex]) {
            log('❌ SBC غير موجود');
            return false;
        }

        currentSBC = sbcList[sbcIndex];
        log(`🎯 فتح SBC: ${currentSBC.name}`);

        currentSBC.element.click();
        await wait(CONFIG.WAIT_TIME);

        // Click on first challenge if multiple challenges exist
        const challenges = document.querySelectorAll('.ut-sbc-challenge-tile, .challenge-tile');
        if (challenges.length > 0) {
            // Find incomplete challenge
            for (const challenge of challenges) {
                const isComplete = challenge.querySelector('.completed, .checkmark');
                if (!isComplete) {
                    challenge.click();
                    await wait(CONFIG.WAIT_TIME);
                    break;
                }
            }
        }

        return true;
    }

    // ========== استخدام Smart Build ==========
    async function usePaletoolsSmartBuild() {
        log('🤖 استخدام Smart Build من Paletools...');

        // Look for Paletools Smart Build button
        const smartBuildSelectors = [
            'button:contains("Smart Build")',
            'button[class*="smart"]',
            '.paletools-smart-build',
            '[data-paletools="smart-build"]',
            'button:contains("Auto")',
            'button:contains("Build")'
        ];

        // Try to find Smart Build button
        for (const selector of smartBuildSelectors) {
            const button = findElementByText('Smart Build', 'button') ||
                findElementByText('Auto Build', 'button') ||
                document.querySelector(selector);

            if (button) {
                button.click();
                log('✅ تم تشغيل Smart Build');
                await wait(CONFIG.WAIT_TIME * 2);
                return true;
            }
        }

        // Alternative: Try keyboard shortcut if Paletools has one
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));
        await wait(CONFIG.WAIT_TIME);

        log('⚠️ Smart Build قد يكون تم تشغيله (أو غير متوفر)');
        return true;
    }

    // ========== تقديم SBC ==========
    async function submitSBC() {
        log('📤 إرسال SBC...');

        // Wait for squad to be built
        await wait(CONFIG.WAIT_TIME);

        // Click submit/exchange button
        const submitSelectors = [
            'button.btn-standard.call-to-action',
            'button:contains("Submit")',
            'button:contains("Exchange")',
            'button[class*="submit"]',
            '.ut-button-group button.call-to-action'
        ];

        for (const selector of submitSelectors) {
            if (await clickElement(selector)) {
                log('✅ تم تقديم SBC');
                await wait(CONFIG.WAIT_TIME);

                // Confirm if needed
                const confirmButton = findElementByText('Confirm', 'button') ||
                    findElementByText('Yes', 'button');
                if (confirmButton) {
                    confirmButton.click();
                    await wait(CONFIG.WAIT_TIME);
                }

                sbcsCompleted++;
                updateUI();
                return true;
            }
        }

        log('❌ فشل تقديم SBC');
        return false;
    }

    // ========== فتح المكافآت ==========
    async function claimRewards() {
        log('🎁 استلام المكافآت...');

        await wait(1000);

        // Click through rewards
        const rewardSelectors = [
            'button.ut-button',
            'button:contains("Ok")',
            'button:contains("Claim")',
            '.ut-click-shield'
        ];

        for (let i = 0; i < 5; i++) {
            for (const selector of rewardSelectors) {
                await clickElement(selector);
            }

            // Click anywhere on screen to skip animations
            document.body.click();
            await wait(500);
        }

        log('✅ تم استلام المكافآت');
        return true;
    }

    // ========== فتح البكجات ==========
    async function openPacks(count = 1) {
        log(`📦 فتح ${count} بكج...`);

        // Navigate to store
        await goToStore();
        await wait(CONFIG.WAIT_TIME);

        for (let i = 0; i < count; i++) {
            const success = await openSinglePack();
            if (!success) break;

            await wait(CONFIG.WAIT_TIME);
        }

        log(`✅ تم فتح ${count} بكج`);
    }

    async function goToStore() {
        log('🏪 الانتقال إلى المتجر...');

        const storeSelectors = [
            'button.ut-tab-bar-item.icon-store',
            'a[href*="store"]',
            'button[class*="store"]',
            '.icon-store'
        ];

        for (const selector of storeSelectors) {
            if (await clickElement(selector)) {
                await wait(CONFIG.WAIT_TIME);
                return true;
            }
        }

        return false;
    }

    async function openSinglePack() {
        // Find first pack
        const pack = document.querySelector('.ut-pack-tile, .ut-tile-pack, .pack-item');
        if (!pack) {
            log('❌ لا توجد بكجات متاحة');
            return false;
        }

        pack.click();
        await wait(1000);

        // Open pack
        await clickElement('.btn-standard.call-to-action');
        await wait(CONFIG.WAIT_TIME);

        // Skip animation
        document.body.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        await wait(CONFIG.WAIT_TIME);

        // Handle duplicates
        await handleDuplicates();

        packsOpened++;
        updateUI();

        return true;
    }

    // ========== إدارة اللاعبين المكررين ==========
    async function handleDuplicates() {
        log('🔄 معالجة اللاعبين المكررين...');

        await wait(1500);

        // Get all duplicate items
        const items = document.querySelectorAll('.ut-item, .player-item, [class*="item"]');

        for (const item of items) {
            const isDuplicate = item.querySelector('.duplicate, [class*="duplicate"]');
            if (!isDuplicate) continue;

            // Check rarity
            const isGold = item.classList.contains('gold') ||
                item.classList.contains('rare') ||
                item.querySelector('.gold, .rare');

            const isBronzeOrSilver = item.classList.contains('bronze') ||
                item.classList.contains('silver') ||
                item.querySelector('.bronze, .silver');

            // Select the item
            item.click();
            await wait(300);

            if (isGold && CONFIG.GOLD_DUPLICATES_TO_SBC_STORAGE) {
                // Send gold duplicates to SBC Storage
                const success = await sendToSBCStorage();
                if (success) {
                    goldsSentToStorage++;
                    log('💛 تم إرسال لاعب ذهبي إلى SBC Storage');
                } else if (CONFIG.STOP_ON_SBC_STORAGE_FULL) {
                    log('⚠️ SBC Storage ممتلئ! إيقاف السكربت...');
                    stopScript();
                    return;
                }
            } else if (isBronzeOrSilver && CONFIG.BRONZE_SILVER_QUICK_SELL) {
                // Quick sell bronze/silver duplicates
                await quickSellItem();
                quickSells++;
                log('💰 تم بيع لاعب برونزي/فضي');
            }

            await wait(500);
        }

        // Send remaining items to club
        await clickElement('.store-all, .sendToClub');

        updateUI();
    }

    async function sendToSBCStorage() {
        // Right click or long press on item
        const selectedItem = document.querySelector('.selected, .ut-item--selected');
        if (!selectedItem) return false;

        // Try to open context menu
        selectedItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        await wait(500);

        // Look for "Send to SBC Storage" option
        const sbcStorageBtn = findElementByText('SBC', 'button') ||
            findElementByText('Storage', 'button');

        if (sbcStorageBtn) {
            sbcStorageBtn.click();
            await wait(500);

            // Check if storage is full
            const fullMessage = findElementByText('full', 'div') ||
                findElementByText('maximum', 'div');

            if (fullMessage) {
                return false; // Storage full
            }

            return true;
        }

        // Alternative: Try keyboard shortcut
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
        await wait(500);

        return true;
    }

    async function quickSellItem() {
        // Look for quick sell button
        const quickSellSelectors = [
            'button:contains("Quick Sell")',
            'button[class*="quicksell"]',
            '.quick-sell-button'
        ];

        for (const selector of quickSellSelectors) {
            if (await clickElement(selector)) {
                // Confirm
                const confirmBtn = findElementByText('Confirm', 'button');
                if (confirmBtn) {
                    confirmBtn.click();
                    await wait(300);
                }
                return true;
            }
        }

        return false;
    }

    // ========== العملية الكاملة ==========
    async function completeSBCCycle(sbcIndex) {
        if (!isRunning) return;

        log(`\n🔄 بدء دورة SBC ${sbcsCompleted + 1}...\n`);

        // 1. Go to SBC section
        await goToSBCSection();

        // 2. Get SBC list if not loaded
        if (sbcList.length === 0) {
            await getSBCList();
        }

        // 3. Select and open SBC
        await selectAndOpenSBC(sbcIndex);

        // 4. Use Smart Build
        await usePaletoolsSmartBuild();

        // 5. Submit SBC
        const submitted = await submitSBC();
        if (!submitted) {
            log('❌ فشل تقديم SBC');
            return false;
        }

        // 6. Claim rewards
        await claimRewards();

        // 7. Open packs
        if (CONFIG.PACKS_PER_SBC > 0) {
            await openPacks(CONFIG.PACKS_PER_SBC);
        }

        log(`✅ تم إكمال دورة SBC بنجاح!\n`);
        return true;
    }

    // ========== البدء ==========
    async function startAutoSBC(sbcIndex = 0, cycles = 1) {
        if (isRunning) {
            log('⚠️ السكربت يعمل بالفعل!');
            return;
        }

        isRunning = true;
        log('🚀 بدء SBC Auto Completer...\n');
        updateUI();

        for (let i = 0; i < cycles; i++) {
            if (!isRunning) break;

            const success = await completeSBCCycle(sbcIndex);
            if (!success) {
                log('❌ حدث خطأ، إيقاف السكربت');
                break;
            }

            await wait(CONFIG.WAIT_TIME);
        }

        stopScript();
    }

    function stopScript() {
        isRunning = false;
        log('\n⏸️ تم إيقاف السكربت');
        updateUI();
    }

    // ========== واجهة المستخدم ==========
    function createUI() {
        if (document.getElementById('sbc-auto-ui')) return;

        const ui = document.createElement('div');
        ui.id = 'sbc-auto-ui';
        ui.innerHTML = `
            <style>
                #sbc-auto-ui {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 15px;
                    padding: 20px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    z-index: 999999;
                    font-family: Arial, sans-serif;
                    color: white;
                    min-width: 320px;
                    max-height: 90vh;
                    overflow-y: auto;
                }
                
                #sbc-auto-ui h3 {
                    margin: 0 0 15px 0;
                    font-size: 18px;
                    text-align: center;
                    font-weight: bold;
                }
                
                #sbc-auto-ui .stats {
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                    padding: 15px;
                    margin-bottom: 15px;
                }
                
                #sbc-auto-ui .stat-item {
                    display: flex;
                    justify-content: space-between;
                    margin: 8px 0;
                    font-size: 13px;
                }
                
                #sbc-auto-ui .stat-item .label {
                    opacity: 0.9;
                }
                
                #sbc-auto-ui .stat-item .value {
                    font-weight: bold;
                    font-size: 14px;
                }
                
                #sbc-auto-ui .sbc-selector {
                    margin-bottom: 15px;
                }
                
                #sbc-auto-ui select {
                    width: 100%;
                    padding: 10px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    background: rgba(255,255,255,0.9);
                    color: #333;
                    margin-top: 5px;
                }
                
                #sbc-auto-ui input[type="number"] {
                    width: 100%;
                    padding: 10px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    margin-top: 5px;
                }
                
                #sbc-auto-ui button {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.3s;
                    margin: 5px 0;
                }
                
                #sbc-auto-ui .btn-start {
                    background: #10b981;
                    color: white;
                }
                
                #sbc-auto-ui .btn-start:hover {
                    background: #059669;
                    transform: translateY(-2px);
                }
                
                #sbc-auto-ui .btn-stop {
                    background: #ef4444;
                    color: white;
                }
                
                #sbc-auto-ui .btn-refresh {
                    background: #3b82f6;
                    color: white;
                }
                
                #sbc-auto-ui .btn-close {
                    background: rgba(255,255,255,0.2);
                    color: white;
                    font-size: 12px;
                    padding: 8px;
                }
                
                #sbc-auto-ui .settings {
                    background: rgba(255,255,255,0.1);
                    border-radius: 10px;
                    padding: 10px;
                    margin-bottom: 15px;
                    font-size: 12px;
                }
                
                #sbc-auto-ui .setting-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin: 8px 0;
                }
                
                #sbc-auto-ui input[type="checkbox"] {
                    width: 20px;
                    height: 20px;
                }
                
                #sbc-auto-ui .log {
                    background: rgba(0,0,0,0.3);
                    border-radius: 8px;
                    padding: 10px;
                    max-height: 150px;
                    overflow-y: auto;
                    font-size: 11px;
                    font-family: 'Courier New', monospace;
                    margin-top: 10px;
                }
                
                #sbc-auto-ui .log-entry {
                    margin: 2px 0;
                    padding: 2px 0;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
            </style>
            
            <h3>🎯 SBC Auto Completer</h3>
            
            <div class="stats">
                <div class="stat-item">
                    <span class="label">✅ SBCs مكتملة:</span>
                    <span class="value" id="sbcs-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">📦 بكجات مفتوحة:</span>
                    <span class="value" id="packs-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">💛 ذهبيين → Storage:</span>
                    <span class="value" id="golds-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="label">💰 Quick Sells:</span>
                    <span class="value" id="sells-count">0</span>
                </div>
            </div>
            
            <div class="sbc-selector">
                <label>اختر SBC:</label>
                <select id="sbc-select">
                    <option value="-1">-- حمّل القائمة أولاً --</option>
                </select>
            </div>
            
            <div class="sbc-selector">
                <label>عدد التكرارات:</label>
                <input type="number" id="cycles-input" value="1" min="1" max="100">
            </div>
            
            <div class="settings">
                <div class="setting-item">
                    <span>ذهبيين → SBC Storage</span>
                    <input type="checkbox" id="gold-storage" checked>
                </div>
                <div class="setting-item">
                    <span>برونز/فضي → Quick Sell</span>
                    <input type="checkbox" id="bronze-silver-sell" checked>
                </div>
                <div class="setting-item">
                    <span>إيقاف عند امتلاء Storage</span>
                    <input type="checkbox" id="stop-full" checked>
                </div>
            </div>
            
            <button class="btn-refresh" id="refresh-btn">🔄 تحميل قائمة SBCs</button>
            <button class="btn-start" id="start-btn">▶️ بدء التشغيل التلقائي</button>
            <button class="btn-stop" id="stop-btn" style="display:none">⏸️ إيقاف</button>
            <button class="btn-close" id="close-btn">✖️ إغلاق</button>
            
            <div class="log" id="log-container">
                <div class="log-entry">جاهز للبدء...</div>
            </div>
        `;

        document.body.appendChild(ui);

        // Event listeners
        document.getElementById('refresh-btn').addEventListener('click', async () => {
            log('🔄 جاري تحميل قائمة SBCs...');
            await goToSBCSection();
            await getSBCList();

            const select = document.getElementById('sbc-select');
            select.innerHTML = '';

            if (sbcList.length === 0) {
                select.innerHTML = '<option value="-1">-- لا توجد SBCs متاحة --</option>';
                log('❌ لم يتم العثور على SBCs');
            } else {
                sbcList.forEach((sbc, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = sbc.name;
                    select.appendChild(option);
                });
                log(`✅ تم تحميل ${sbcList.length} SBC`);
            }
        });

        document.getElementById('start-btn').addEventListener('click', () => {
            const sbcIndex = parseInt(document.getElementById('sbc-select').value);
            const cycles = parseInt(document.getElementById('cycles-input').value);

            if (sbcIndex < 0) {
                alert('⚠️ اختر SBC من القائمة أولاً!');
                return;
            }

            // Update config from checkboxes
            CONFIG.GOLD_DUPLICATES_TO_SBC_STORAGE = document.getElementById('gold-storage').checked;
            CONFIG.BRONZE_SILVER_QUICK_SELL = document.getElementById('bronze-silver-sell').checked;
            CONFIG.STOP_ON_SBC_STORAGE_FULL = document.getElementById('stop-full').checked;

            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'block';
            document.getElementById('refresh-btn').disabled = true;

            startAutoSBC(sbcIndex, cycles);
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            stopScript();
            document.getElementById('start-btn').style.display = 'block';
            document.getElementById('stop-btn').style.display = 'none';
            document.getElementById('refresh-btn').disabled = false;
        });

        document.getElementById('close-btn').addEventListener('click', () => {
            stopScript();
            ui.remove();
        });
    }

    function updateUI() {
        document.getElementById('sbcs-count').textContent = sbcsCompleted;
        document.getElementById('packs-count').textContent = packsOpened;
        document.getElementById('golds-count').textContent = goldsSentToStorage;
        document.getElementById('sells-count').textContent = quickSells;
    }

    function log(message) {
        console.log(message);

        const logContainer = document.getElementById('log-container');
        if (logContainer) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = `${new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${message}`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;

            // Keep only last 50 entries
            while (logContainer.children.length > 50) {
                logContainer.removeChild(logContainer.firstChild);
            }
        }
    }

    // ========== تهيئة ==========
    console.log('✅ Paletools SBC Auto Completer loaded!');
    createUI();
    log('✅ تم تحميل السكربت بنجاح');
    log('💡 اضغط "تحميل قائمة SBCs" للبدء');

})();
