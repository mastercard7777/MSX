import { world, system } from '@minecraft/server';
import { http, HttpRequest, HttpRequestMethod } from '@minecraft/server-net';

// ===== 설정 =====
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

// 시스템 프롬프트 - Gemini에게 역할 지정
const SYSTEM_PROMPT = `당신은 Minecraft Bedrock Edition의 커맨드 전문가입니다.
사용자의 요청을 듣고 정확한 Minecraft 커맨드를 생성해주세요.

규칙:
1. 커맨드는 /execute, /give, /summon, /fill, /setblock 등 Bedrock Edition 문법을 정확히 따라야 합니다
2. Java Edition과 Bedrock Edition의 차이점을 이해하고 Bedrock 문법을 사용하세요
3. 커맨드를 먼저 제시하고, 그 다음 간단한 설명을 추가하세요
4. 복잡한 요청은 여러 커맨드로 나누어 설명하세요
5. 커맨드는 코드 블록(백틱 3개)으로 감싸주세요
6. 한국어로 친절하게 답변하세요

예시:
사용자: "다이아몬드 검 10개 주세요"
답변: 
\`\`\`
/give @s diamond_sword 10
\`\`\`
이 커맨드는 자신에게 다이아몬드 검 10개를 지급합니다.`;

// ===== 메인 커맨드 헬퍼 =====
world.beforeEvents.chatSend.subscribe(async (event) => {
    const player = event.sender;
    const message = event.message;
    
    // !cmd 또는 !커맨드 명령어 감지
    if (message.startsWith('!cmd ') || message.startsWith('!커맨드 ')) {
        event.cancel = true;
        
        const query = message.replace(/^!(cmd|커맨드)\s+/, '');
        
        // 로딩 메시지
        player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
        player.sendMessage('§6[커맨드 AI]§r 커맨드 생성 중...');
        player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
        
        try {
            const response = await getCommandHelp(query, player.name);
            displayCommandResponse(player, response);
        } catch (error) {
            player.sendMessage('§c[오류]§r AI 응답을 가져올 수 없습니다.');
            player.sendMessage(`§c${error.message}`);
            console.error('Gemini API Error:', error);
        }
    }
    
    // 도움말 명령어
    if (message === '!cmd' || message === '!커맨드') {
        event.cancel = true;
        showHelp(player);
    }
});

// ===== Gemini API 호출 =====
async function getCommandHelp(userQuery, playerName) {
    const request = new HttpRequest(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`);
    
    request.method = HttpRequestMethod.Post;
    request.setHeaders({
        'Content-Type': 'application/json'
    });
    
    const fullPrompt = `${SYSTEM_PROMPT}\n\n사용자 요청: ${userQuery}`;
    
    request.body = JSON.stringify({
        contents: [{
            parts: [{
                text: fullPrompt
            }]
        }],
        generationConfig: {
            temperature: 0.3, // 정확성을 위해 낮은 temperature
            maxOutputTokens: 1500,
            topP: 0.8,
            topK: 40
        }
    });
    
    request.timeout = 10; // 10초 타임아웃
    
    const response = await http.request(request);
    
    // 응답 상태 확인
    if (response.status !== 200) {
        throw new Error(`API 오류: 상태 코드 ${response.status}`);
    }
    
    const data = JSON.parse(response.body);
    
    if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
    }
    
    throw new Error('응답을 받을 수 없습니다.');
}

// ===== 응답 표시 =====
function displayCommandResponse(player, response) {
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
    player.sendMessage('§a[커맨드 AI 응답]');
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
    
    // 커맨드 추출 (백틱으로 감싸진 부분)
    const commandRegex = /```([\s\S]*?)```/g;
    let match;
    let commands = [];
    let explanationText = response;
    
    // 커맨드 추출
    while ((match = commandRegex.exec(response)) !== null) {
        let command = match[1].trim();
        // 언어 지정자 제거 (예: ```minecraft)
        command = command.replace(/^(minecraft|mcfunction|)\n/, '');
        commands.push(command);
        explanationText = explanationText.replace(match[0], '');
    }
    
    // 커맨드 표시
    if (commands.length > 0) {
        player.sendMessage('§b▶ 생성된 커맨드:§r');
        commands.forEach((cmd, index) => {
            player.sendMessage(`§7${index + 1}.§r §e${cmd}§r`);
            
            // 커맨드 복사 힌트
            if (index === 0) {
                player.sendMessage('§8(채팅창에 입력하거나 커맨드 블록에 붙여넣으세요)§r');
            }
        });
        player.sendMessage('');
    }
    
    // 설명 표시
    const lines = explanationText.trim().split('\n');
    lines.forEach(line => {
        if (line.trim()) {
            sendMessageWithDelay(player, `§f${line.trim()}§r`);
        }
    });
    
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
}

// ===== 메시지 전송 (딜레이 포함) =====
let messageQueue = new Map();

function sendMessageWithDelay(player, message) {
    const playerId = player.id;
    
    if (!messageQueue.has(playerId)) {
        messageQueue.set(playerId, []);
    }
    
    const queue = messageQueue.get(playerId);
    queue.push(message);
    
    if (queue.length === 1) {
        processMessageQueue(player);
    }
}

function processMessageQueue(player) {
    const playerId = player.id;
    const queue = messageQueue.get(playerId);
    
    if (!queue || queue.length === 0) {
        messageQueue.delete(playerId);
        return;
    }
    
    const message = queue.shift();
    
    try {
        player.sendMessage(message);
    } catch (error) {
        console.warn('메시지 전송 실패:', error);
    }
    
    if (queue.length > 0) {
        system.runTimeout(() => {
            processMessageQueue(player);
        }, 3);
    } else {
        messageQueue.delete(playerId);
    }
}

function showHelp(player) {
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
    player.sendMessage('§6§l커맨드 AI 도우미');
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
    player.sendMessage('');
    player.sendMessage('§b사용법:§r');
    player.sendMessage('§7!cmd <원하는 작업>§r');
    player.sendMessage('§7!커맨드 <원하는 작업>§r');
    player.sendMessage('');
    player.sendMessage('§b예시:§r');
    player.sendMessage('§7!cmd 다이아몬드 검 10개 주세요§r');
    player.sendMessage('§7!cmd 반경 5칸 내 돌을 공기로 채워주세요§r');
    player.sendMessage('§7!cmd 크리퍼를 소환해주세요§r');
    player.sendMessage('§7!cmd 날씨를 맑게 해주세요§r');
    player.sendMessage('§7!cmd 내 위치에 횃불 설치§r');
    player.sendMessage('');
    player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
}

const quickCommands = {
    '날씨': [
        { query: '날씨 맑게', desc: '날씨를 맑게' },
        { query: '비 오게', desc: '비 내리게' },
        { query: '천둥', desc: '천둥 치게' }
    ],
    '시간': [
        { query: '낮으로', desc: '시간을 낮으로' },
        { query: '밤으로', desc: '시간을 밤으로' },
        { query: '정오', desc: '정오로 설정' }
    ],
    '아이템': [
        { query: '다이아 검', desc: '다이아몬드 검 받기' },
        { query: '다이아 갑옷', desc: '다이아몬드 갑옷 세트' }
    ]
};

world.beforeEvents.chatSend.subscribe((event) => {
    const player = event.sender;
    const message = event.message;
    
    if (message === '!퀵' || message === '!quick') {
        event.cancel = true;
        
        player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
        player.sendMessage('§6빠른 커맨드 카테고리');
        player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
        
        Object.keys(quickCommands).forEach(category => {
            player.sendMessage(`§a▶ ${category}§r`);
            quickCommands[category].forEach(cmd => {
                player.sendMessage(`  §7!cmd ${cmd.query}§r - ${cmd.desc}`);
            });
        });
        
        player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
    }
});

world.afterEvents.worldLoad.subscribe((event) => {
    const player = event.player;
   
        system.runTimeout(() => {
            player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
            player.sendMessage('§6커맨드 AI 활성화');
            player.sendMessage('§7!cmd 또는 !커맨드 입력으로 시작');
            player.sendMessage('§e━━━━━━━━━━━━━━━━━━━━━━');
        }, 40);
});

console.warn('[Command AI] 커맨드 도우미 로드 (API v2.3.0)');
console.warn('[Command AI] Gemini API 사용');