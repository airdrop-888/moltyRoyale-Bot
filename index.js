/*
 * package.json dependencies required:
 * {
 *   "type": "module",
 *   "dependencies": {
 *     "inquirer": "^9.2.12",
 *     "chalk": "^5.3.0"
 *   }
 * }
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';

const ACCOUNTS_FILE = 'accounts.txt';
const BASE_URL = 'https://cdn.moltyroyale.com/api';

function checkAccounts() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim() !== '');
    console.log(chalk.cyan(`[Info] ${lines.length} accounts found in ${ACCOUNTS_FILE}.`));
  }
}

// Custom sleep function that checks for early exit
function sleepAndCheck(ms) {
    return new Promise(resolve => {
        let elapsed = 0;
        const interval = 100;
        const timer = setInterval(() => {
            elapsed += interval;
            if (!global.isBotRunning || elapsed >= ms) {
                clearInterval(timer);
                resolve();
            }
        }, interval);
    });
}

function decideAction(state) {
  const { self, currentRegion, visibleAgents, visibleMonsters } = state;
  if (currentRegion.isDeathZone && currentRegion.connections.length > 0) {
    return { type: 'move', regionId: currentRegion.connections[0] };
  }
  if (self.hp < 30) {
    const healItem = self.inventory?.find(i => i.category === 'recovery');
    if (healItem) return { type: 'use_item', itemId: healItem.id };
  }
  if (self.ep < 2) return { type: 'rest' };
  const enemy = visibleAgents?.find(a => a.regionId === self.regionId && a.isAlive);
  if (enemy) return { type: 'attack', targetId: enemy.id, targetType: 'agent' };
  const monster = visibleMonsters?.find(m => m.regionId === self.regionId);
  if (monster) return { type: 'attack', targetId: monster.id, targetType: 'monster' };
  return { type: 'explore' };
}

// Provided Bot Strategy Logic
async function runBotLoop(API_KEY, WALLET_ADDRESS) {
  // 1. Find available game (oldest waiting game)
  const gamesRes = await fetch(`${BASE_URL}/games?status=waiting`);
  const { data: games } = await gamesRes.json();
  if (!games || games.length === 0) {
    console.log(chalk.yellow('No waiting games available'));
    return;
  }
  const GAME_ID = games[0].id;
  console.log(chalk.blue(`Joining game: ${games[0].name} (ID: ${GAME_ID})`));

  // 2. Register agent
  const registerRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: JSON.stringify({ name: 'JSBot' })
  });
  
  if (!registerRes.ok) {
    const errText = await registerRes.text();
    console.log(chalk.red(`Failed to register agent. Check API Key. Response: ${errText}`));
    return;
  }
  
  const { data: agent } = await registerRes.json();
  const AGENT_ID = agent.id;
  console.log(chalk.green(`Registered: ${agent.name}`));

  // 3. Game loop (interruptible by user keypress)
  global.isBotRunning = true;
  while (global.isBotRunning) {
    const stateRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/state`);
    
    if (!stateRes.ok) {
        console.log(chalk.red(`Failed to fetch state: ${stateRes.statusText}`));
        await sleepAndCheck(5000);
        continue;
    }

    const { data: state } = await stateRes.json();

    if (!state.self.isAlive) {
      console.log(chalk.red('Agent died...'));
      break;
    }
    if (state.gameStatus === 'finished') {
      console.log(chalk.green('Game over. Winner:'), state.result?.isWinner, chalk.yellow('Rewards:'), state.result?.rewards);
      break;
    }

    const { self, currentRegion, visibleAgents, visibleItems, recentMessages } = state;

    // === FREE ACTIONS ===
    for (const msg of recentMessages || []) {
      if (msg.content?.startsWith('[저주]') && msg.senderId !== AGENT_ID) {
        console.log(chalk.gray('Curse detected, ignoring LLM for simple script...'));
      }
    }

    for (const entry of visibleItems || []) {
      if (entry.regionId === self.regionId) {
        await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: { type: 'pickup', itemId: entry.item.id } })
        });
      }
    }

    // === MAIN ACTION ===
    const action = decideAction(state);

    const actionRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        thought: { reasoning: `HP:${self.hp} EP:${self.ep}`, plannedAction: action.type }
      })
    });
    
    if (actionRes.ok) {
        const result = await actionRes.json();
        console.log(`[Turn] ${chalk.cyan(action.type)} - ${result.message || ''}`);
    } else {
        console.log(chalk.red(`[Turn] Action failed: ${actionRes.statusText}`));
    }

    // Replaced standard 60s timeout with interruptible sleep check
    await sleepAndCheck(60000);
  }
}

async function startBot(API_KEY, WALLET_ADDRESS) {
  console.log(chalk.magenta('\n========================================='));
  console.log(chalk.magenta('   BOT RUNNING - PRESS s or q TO STOP'));
  console.log(chalk.magenta('=========================================\n'));

  // Setup raw standard input logging separation & graceful stop
  const stdin = process.stdin;
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
  }

  global.isBotRunning = true;

  const keypressListener = function (key) {
    if (key === 's' || key === 'q' || key === '\u0003') { // including generic exit ctrl+c signal
      global.isBotRunning = false;
      console.log(chalk.yellow('\n[Stop request received] Stopping loop gracefully...'));
      // Clean up stdin so it doesn't block exits after gracefully stopping
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.removeListener('data', keypressListener);
      stdin.pause();
    }
  };

  stdin.on('data', keypressListener);

  try {
    await runBotLoop(API_KEY, WALLET_ADDRESS);
  } catch (err) {
    console.error(chalk.red('Error in bot loop:'), err);
  } finally {
    if (stdin.isTTY && global.isBotRunning) {
        stdin.setRawMode(false);
    }
    stdin.removeListener('data', keypressListener);
    stdin.pause();
    global.isBotRunning = false;
  }

  console.log(chalk.magenta('\n========================================='));
  console.log(chalk.magenta('              BOT STOPPED'));
  console.log(chalk.magenta('=========================================\n'));

  await mainMenu();
}

async function createAccount() {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'botName', message: 'Enter Bot Name:' }
  ]);

  // Automatically generate a valid random EVM dummy address
  const walletAddress = '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

  try {
    const response = await fetch(`${BASE_URL}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: answers.botName, wallet_address: walletAddress })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.log(chalk.red('\nFailed to create account.'));
      console.log(chalk.red(`Status: ${response.status} ${response.statusText}`));
      console.log(chalk.red(`Response: ${errText}\n`));
      return await mainMenu();
    }
    
    const resBase = await response.json();
    const data = resBase.data || resBase;

    console.log(chalk.green('\n--- Account Created ---'));
    console.log(chalk.bold('Name: ') + chalk.white(data.name || answers.botName));
    console.log(chalk.bold('Account ID: ') + chalk.white(data.accountId || data.id || 'N/A'));
    console.log(chalk.bold('Public ID: ') + chalk.white(data.publicId || data.public_id || 'N/A'));
    console.log(chalk.bold('Balance: ') + chalk.yellow(data.balance !== undefined ? data.balance : 0));
    console.log(chalk.green('-----------------------\n'));

    const apiKey = data.apiKey || data.api_key;

    if (!apiKey) {
      console.log(chalk.red('API Key was not returned by the server. Account not saved.\n'));
      return await mainMenu();
    }

    const line = `${apiKey}||${walletAddress}|`;
    fs.appendFileSync(ACCOUNTS_FILE, line + '\n');
    console.log(chalk.cyan(`Saved to ${ACCOUNTS_FILE} successfully.\n`));
    console.log(chalk.yellow(`⚠ apiKey is only fully visible here. Save it securely!\n`));

  } catch (err) {
    console.error(chalk.red('Error creating account:'), err);
  }

  await mainMenu();
}

async function playAgent() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.log(chalk.red('No accounts.txt found. Please create an account first.'));
    return await mainMenu();
  }

  const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
  const lines = data.split('\n').filter(line => line.trim() !== '');

  if (lines.length === 0) {
    console.log(chalk.red('No accounts found in accounts.txt.'));
    return await mainMenu();
  }

  const choices = lines.map(line => {
    // Expected strict format: API_KEY||WALLET_ADDRESS|
    const parts = line.split('||');
    const api_key = parts[0];
    const wallet = parts[1] ? parts[1].replace('|', '') : '';
    return { name: `Wallet: ${wallet || 'Unknown'} (Key: ${api_key.substring(0,6)}...)`, value: { api_key, wallet } };
  });

  choices.push({ name: 'Cancel', value: null });

  const { account } = await inquirer.prompt([
    {
      type: 'list',
      name: 'account',
      message: 'Select an account to play:',
      choices
    }
  ]);

  if (!account) {
    return await mainMenu();
  }

  await startBot(account.api_key, account.wallet);
}

async function mainMenu() {
  console.log();
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'Main Menu',
      choices: [
        '1. Create Account',
        '2. Play Agent',
        '3. Exit'
      ]
    }
  ]);

  if (choice === '1. Create Account') {
    await createAccount();
  } else if (choice === '2. Play Agent') {
    await playAgent();
  } else {
    console.log(chalk.cyan('Exiting... Goodbye!'));
    process.exit(0);
  }
}

async function start() {
    console.clear();
    console.log(chalk.cyan.bold('========================================='));
    console.log(chalk.cyan.bold('       Molty Royale CLI Manager'));
    console.log(chalk.cyan.bold('=========================================\n'));
    checkAccounts();
    await mainMenu();
}

start();
