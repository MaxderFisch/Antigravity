const levels = [
    {
        name: "1: Geradeaus",
        grid: [
            [0, 0, 0, 0, 0],
            [2, 0, 0, 0, 3],
            [0, 0, 0, 0, 0]
        ],
        startDir: 1 // East
    },
    {
        name: "2: Die Kurve",
        grid: [
            [2, 0, 0, 0],
            [1, 1, 1, 0],
            [0, 0, 0, 0],
            [0, 1, 1, 1],
            [0, 0, 0, 3]
        ],
        startDir: 1
    },
    {
        name: "3: Zick-Zack (Loop Time!)",
        grid: [
            [2, 0, 1, 1, 1],
            [1, 0, 0, 1, 1],
            [1, 1, 0, 0, 1],
            [1, 1, 1, 0, 3]
        ],
        startDir: 1
    }
];

let currentLevelIndex = 0;
let isRunning = false;
let robotState = { x: 0, y: 0, dir: 1 }; // dir: 0=N, 1=E, 2=S, 3=W
const CELL_SIZE = 50;

// DOM Elements
const levelSelect = document.getElementById('levelSelect');
const gameBoard = document.getElementById('gameBoard');
const programArea = document.getElementById('programArea');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const shareBtn = document.getElementById('shareBtn');
const currentScoreEl = document.getElementById('currentScore');
const highScoreEl = document.getElementById('highScore');
const gameStatus = document.getElementById('gameStatus');
const toast = document.getElementById('toast');

let activeContainer = programArea;
let abortController = null;

// Initialize
function init() {
    levels.forEach((lvl, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.innerText = lvl.name;
        levelSelect.appendChild(opt);
    });

    levelSelect.addEventListener('change', (e) => {
        currentLevelIndex = parseInt(e.target.value);
        loadLevel();
    });

    // Check URL Hash for shared level
    if (window.location.hash) {
        loadFromHash();
    } else {
        loadLevel();
    }

    programArea.addEventListener('click', (e) => {
        if (e.target === programArea || e.target.classList.contains('empty-state')) {
            setActiveContainer(programArea);
        }
    });
}

function setActiveContainer(container) {
    document.querySelectorAll('.loop-body').forEach(el => el.classList.remove('active'));
    if (container !== programArea) {
        container.classList.add('active');
    }
    activeContainer = container;
}

function loadLevel() {
    stopExecution();
    const level = levels[currentLevelIndex];
    gameBoard.innerHTML = '';
    
    const rows = level.grid.length;
    const cols = level.grid[0].length;
    
    gameBoard.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;
    gameBoard.style.gridTemplateRows = `repeat(${rows}, ${CELL_SIZE}px)`;
    
    let startFound = false;
    
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            
            if (level.grid[y][x] === 1) cell.classList.add('wall');
            if (level.grid[y][x] === 2) {
                cell.classList.add('start');
                robotState = { x, y, dir: level.startDir };
                startFound = true;
            }
            if (level.grid[y][x] === 3) cell.classList.add('goal');
            
            gameBoard.appendChild(cell);
        }
    }
    
    if (startFound) {
        const robot = document.createElement('div');
        robot.id = 'robot';
        robot.classList.add('robot');
        robot.innerText = '🤖';
        gameBoard.appendChild(robot);
        updateRobotVisuals();
    }
    
    updateHighscoreDisplay();
    setStatus('READY', 'idle');
}

function updateRobotVisuals() {
    const robot = document.getElementById('robot');
    if (!robot) return;
    
    robot.style.left = `${robotState.x * (CELL_SIZE + 2)}px`; // +2 for grid gap
    robot.style.top = `${robotState.y * (CELL_SIZE + 2)}px`;
    
    let rotation = robotState.dir * 90;
    // To prevent spinning backwards when going from 270 to 0 (W to N)
    // we would need a more complex rotation state, but this is fine for now
    robot.style.transform = `rotate(${rotation}deg)`;
}

// Block Editor Logic
function addBlock(type) {
    const emptyState = programArea.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const block = document.createElement('div');
    block.classList.add('prog-block', type);
    block.dataset.type = type;

    if (type === 'move') {
        block.innerHTML = `<span>🚶 Move</span><button class="remove-btn" onclick="this.parentElement.remove(); updateScore();">×</button>`;
    } else if (type === 'turnRight') {
        block.innerHTML = `<span>↻ Turn Right</span><button class="remove-btn" onclick="this.parentElement.remove(); updateScore();">×</button>`;
    } else if (type === 'turnLeft') {
        block.innerHTML = `<span>↺ Turn Left</span><button class="remove-btn" onclick="this.parentElement.remove(); updateScore();">×</button>`;
    } else if (type === 'loop') {
        block.innerHTML = `
            <div class="loop-header">
                <span>🔁 Loop <input type="number" class="val-input" value="3" min="1" max="99"> x</span>
                <button class="remove-btn" onclick="this.parentElement.parentElement.remove(); setActiveContainer(document.getElementById('programArea')); updateScore();">×</button>
            </div>
            <div class="loop-body" onclick="event.stopPropagation(); setActiveContainer(this);"></div>
        `;
    }

    activeContainer.appendChild(block);
    
    if (type === 'loop') {
        setActiveContainer(block.querySelector('.loop-body'));
    }
    
    updateScore();
}

function getBlockCount(container) {
    let count = 0;
    const blocks = container.children;
    for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].classList.contains('prog-block')) continue;
        count++;
        if (blocks[i].dataset.type === 'loop') {
            const loopBody = blocks[i].querySelector('.loop-body');
            if (loopBody) {
                count += getBlockCount(loopBody);
            }
        }
    }
    return count;
}

function updateScore() {
    const count = getBlockCount(programArea);
    currentScoreEl.innerText = count;
    return count;
}

// Execution Logic
const delay = ms => new Promise(res => setTimeout(res, ms));

async function executeBlocks(container, signal) {
    const blocks = container.children;
    for (let i = 0; i < blocks.length; i++) {
        if (signal.aborted) throw new Error("Aborted");
        
        const block = blocks[i];
        if (!block.classList.contains('prog-block')) continue;
        
        block.style.boxShadow = '0 0 10px white, inset 0 0 10px rgba(255,255,255,0.5)';
        
        const type = block.dataset.type;
        
        if (type === 'move') {
            await moveRobot(signal);
        } else if (type === 'turnRight') {
            robotState.dir = (robotState.dir + 1) % 4;
            updateRobotVisuals();
            await delay(400);
        } else if (type === 'turnLeft') {
            robotState.dir = (robotState.dir + 3) % 4; // -1 mod 4
            updateRobotVisuals();
            await delay(400);
        } else if (type === 'loop') {
            const iterations = parseInt(block.querySelector('.val-input').value) || 1;
            const loopBody = block.querySelector('.loop-body');
            for (let j = 0; j < iterations; j++) {
                if (signal.aborted) throw new Error("Aborted");
                await executeBlocks(loopBody, signal);
            }
        }
        
        block.style.boxShadow = 'none';
        
        // Check win/lose after each block action
        const result = checkGameState();
        if (result !== 'playing') {
            return result;
        }
    }
    return 'playing'; // Still playing, but out of commands
}

async function moveRobot(signal) {
    const level = levels[currentLevelIndex];
    let dx = 0; let dy = 0;
    if (robotState.dir === 0) dy = -1;
    if (robotState.dir === 1) dx = 1;
    if (robotState.dir === 2) dy = 1;
    if (robotState.dir === 3) dx = -1;
    
    robotState.x += dx;
    robotState.y += dy;
    
    updateRobotVisuals();
    await delay(500);
}

function checkGameState() {
    const level = levels[currentLevelIndex];
    const rows = level.grid.length;
    const cols = level.grid[0].length;
    
    if (robotState.x < 0 || robotState.x >= cols || robotState.y < 0 || robotState.y >= rows) {
        return 'crash'; // Out of bounds
    }
    
    const cellValue = level.grid[robotState.y][robotState.x];
    if (cellValue === 1) {
        return 'crash'; // Wall
    } else if (cellValue === 3) {
        return 'win'; // Goal
    }
    return 'playing';
}

runBtn.addEventListener('click', async () => {
    if (isRunning) return;
    
    // Reset robot position first
    const level = levels[currentLevelIndex];
    const startY = level.grid.findIndex(row => row.includes(2));
    const startX = level.grid[startY].indexOf(2);
    robotState = { x: startX, y: startY, dir: level.startDir };
    updateRobotVisuals();
    
    isRunning = true;
    runBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    setStatus('RUNNING...', 'running');
    
    abortController = new AbortController();
    
    try {
        const finalState = await executeBlocks(programArea, abortController.signal);
        
        if (finalState === 'win') {
            setStatus('MISSION ACCOMPLISHED!', 'success');
            checkHighscore();
        } else if (finalState === 'crash') {
            setStatus('CRASH!', 'crash');
            document.getElementById('robot').innerText = '💥';
        } else {
            setStatus('OUT OF COMMANDS', 'crash');
        }
    } catch (e) {
        if (e.message === 'Aborted') {
            setStatus('STOPPED', 'idle');
        } else {
            console.error(e);
        }
    } finally {
        isRunning = false;
        runBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        
        // Remove highlights
        document.querySelectorAll('.prog-block').forEach(b => b.style.boxShadow = 'none');
    }
});

function stopExecution() {
    if (abortController) {
        abortController.abort();
    }
}

stopBtn.addEventListener('click', stopExecution);

resetBtn.addEventListener('click', () => {
    stopExecution();
    loadLevel();
});

function setStatus(text, className) {
    gameStatus.innerText = text;
    gameStatus.className = `status-badge ${className}`;
}

// Highscore system
function updateHighscoreDisplay() {
    const score = localStorage.getItem(`robogolf-score-${currentLevelIndex}`);
    if (score) {
        highScoreEl.innerText = score;
    } else {
        highScoreEl.innerText = '-';
    }
}

function checkHighscore() {
    const currentLines = updateScore();
    const existing = localStorage.getItem(`robogolf-score-${currentLevelIndex}`);
    
    if (!existing || currentLines < parseInt(existing)) {
        localStorage.setItem(`robogolf-score-${currentLevelIndex}`, currentLines);
        updateHighscoreDisplay();
        showToast(`Neuer Highscore: ${currentLines} Blöcke! 🏆`);
    } else {
        showToast(`Geschafft mit ${currentLines} Blöcken.`);
    }
}

// Sharing logic
function serializeBlocks(container) {
    let str = "";
    const blocks = container.children;
    for (let i = 0; i < blocks.length; i++) {
        if (!blocks[i].classList.contains('prog-block')) continue;
        const type = blocks[i].dataset.type;
        if (type === 'move') str += "M";
        else if (type === 'turnRight') str += "R";
        else if (type === 'turnLeft') str += "L";
        else if (type === 'loop') {
            const val = blocks[i].querySelector('.val-input').value;
            const body = blocks[i].querySelector('.loop-body');
            str += `I${val}[${serializeBlocks(body)}]`;
        }
    }
    return str;
}

function deserializeBlocks(str, container) {
    let i = 0;
    while (i < str.length) {
        const char = str[i];
        if (char === 'M') {
            setActiveContainer(container);
            addBlock('move');
            i++;
        } else if (char === 'R') {
            setActiveContainer(container);
            addBlock('turnRight');
            i++;
        } else if (char === 'L') {
            setActiveContainer(container);
            addBlock('turnLeft');
            i++;
        } else if (char === 'I') {
            i++;
            let numStr = "";
            while (str[i] !== '[') {
                numStr += str[i];
                i++;
            }
            i++; // skip '['
            
            setActiveContainer(container);
            addBlock('loop');
            
            // The newly added block is the last one in the container
            const blockArray = Array.from(container.querySelectorAll('.prog-block'));
            const lastLoop = blockArray[blockArray.length - 1];
            lastLoop.querySelector('.val-input').value = numStr;
            const loopBody = lastLoop.querySelector('.loop-body');
            
            // find matching ']'
            let depth = 1;
            let innerStr = "";
            while (depth > 0 && i < str.length) {
                if (str[i] === '[') depth++;
                else if (str[i] === ']') depth--;
                
                if (depth > 0) innerStr += str[i];
                i++;
            }
            
            deserializeBlocks(innerStr, loopBody);
        } else {
            i++; // fallback
        }
    }
}

shareBtn.addEventListener('click', () => {
    const code = serializeBlocks(programArea);
    if (!code) {
        showToast("Programm ist leer!");
        return;
    }
    const hash = `#lvl=${currentLevelIndex}&c=${code}`;
    const url = window.location.origin + window.location.pathname + hash;
    
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link in Zwischenablage kopiert! 🔗");
        // Also update URL so user sees it
        window.history.replaceState(null, null, hash);
    });
});

function loadFromHash() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    if (params.has('lvl')) {
        currentLevelIndex = parseInt(params.get('lvl'));
        levelSelect.value = currentLevelIndex;
    }
    
    loadLevel();
    
    if (params.has('c')) {
        programArea.innerHTML = ''; // clear empty state
        setActiveContainer(programArea);
        deserializeBlocks(params.get('c'), programArea);
        setActiveContainer(programArea); // reset active to main
        showToast("Shared Solution geladen!");
    }
}

function showToast(msg) {
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Start
init();
