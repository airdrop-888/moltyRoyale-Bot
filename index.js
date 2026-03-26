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
import { ethers } from 'ethers';
import readline from 'readline';

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

// Dashboard Rendering
function printDashboard(gameName, agentName, agentId, state, actionLogs, errorMsg) {
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
  console.log(chalk.magenta('╔════════════════════════════════════════╗'));
  console.log(chalk.magenta('║') + chalk.yellow.bold('     BOT RUNNING: ') + chalk.gray('PRESS s/q TO STOP     ') + chalk.magenta('║'));
  console.log(chalk.magenta('╚════════════════════════════════════════╝'));
  const shortAgentId = agentId ? (agentId.length > 12 ? `${agentId.substring(0, 4)}...${agentId.substring(agentId.length - 4)}` : agentId) : 'N/A';
  console.log(chalk.bold('🎮 Game : ') + chalk.cyan(gameName));
  console.log(chalk.bold('🧑‍🚀 Agent: ') + chalk.green(agentName) + chalk.gray(` (ID: ${shortAgentId})`));

  if (state) {
    const { self, currentRegion, gameStatus } = state;
    const isRunning = gameStatus === 'running';
    console.log(chalk.bold('Status: ') + (isRunning ? chalk.green('RUNNING') : chalk.yellow(gameStatus.toUpperCase())));
    console.log(chalk.cyan('-----------------------------------------'));

    const hpColor = self.hp > 50 ? 'green' : (self.hp > 25 ? 'yellow' : 'red');
    console.log(chalk.bold(`❤️  HP `) + chalk[hpColor](self.hp) + chalk.bold(`  |  ⚡ EP `) + chalk.yellow(self.ep));
    console.log(chalk.bold(`🗺️  Region: `) + chalk.white(currentRegion?.name || 'Unknown'));
  } else {
    console.log(chalk.yellow('\nWaiting for game state...'));
  }

  console.log(chalk.cyan('-----------------------------------------'));
  console.log(chalk.bold('Activity Log:'));
  if (actionLogs.length === 0) console.log(chalk.gray('  (No actions yet)'));
  actionLogs.forEach(log => console.log('  ' + log));

  if (errorMsg) {
    console.log(chalk.cyan('-----------------------------------------'));
    console.log(chalk.red(`[Error] ${errorMsg}`));
  }
  console.log(chalk.magenta('=========================================\n'));
}

// Provided Bot Strategy Logic
async function runBotLoop(API_KEY, WALLET_ADDRESS) {
  // 1. Find available game (oldest waiting free game)
  let GAME_ID = null;
  let selectedGame = null;

  global.isBotRunning = true;
  console.log(chalk.cyan('Searching for available free games...'));

  while (global.isBotRunning) {
    try {
      const gamesRes = await fetch(`${BASE_URL}/games?status=waiting&entryType=free`);
      const { data: games } = await gamesRes.json();

      const freeGames = games?.filter(g => g.entryType === 'free') || [];

      if (freeGames.length > 0) {
        selectedGame = freeGames[0];
        GAME_ID = selectedGame.id;
        break; // found a game, break the wait loop
      }

      process.stdout.write(`\r📡 ${chalk.yellow(`[${new Date().toLocaleTimeString()}] Scanning for FREE tournaments... (Retrying in 10s)`)} `);
    } catch (err) {
      process.stdout.write(`\r⚠️  ${chalk.red(`[${new Date().toLocaleTimeString()}] Network error searching games. (Retrying in 10s)`)} `);
    }
    await sleepAndCheck(10000);
  }

  if (!global.isBotRunning) return; // User stopped the script

  console.log(chalk.blue(`\nJoining game: ${selectedGame.name} (ID: ${GAME_ID})`));

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

  const registerJson = await registerRes.json();
  const agent = registerJson.data || registerJson;
  let AGENT_ID = agent.id || agent.agentId;

  // Fallback to fetch from accounts/me if ID is numeric
  if (AGENT_ID && AGENT_ID.toString().match(/^\d+$/)) {
    const accRes = await fetch(`${BASE_URL}/accounts/me`, { headers: { 'X-API-Key': API_KEY } });
    if (accRes.ok) {
      const accData = (await accRes.json()).data;
      const current = accData?.currentGames?.find(g => g.gameId === GAME_ID);
      if (current && current.agentId) {
        AGENT_ID = current.agentId;
      }
    }
  }

  if (!AGENT_ID) {
    console.log(chalk.red('Could not determine Agent ID.'));
    return;
  }
  let actionLogs = [];
  let lastError = null;
  let currentState = null;

  function render() {
    if (!global.isBotRunning) return;
    printDashboard(selectedGame.name, agent.name || 'Bot', AGENT_ID, currentState, actionLogs, lastError);
  }

  function addLog(msg) {
    if (!global.isBotRunning) return;
    const time = new Date().toLocaleTimeString();
    actionLogs.push(`[${time}] ${msg}`);
    if (actionLogs.length > 8) actionLogs.shift();
    render();
  }

  function setError(msg) {
    lastError = msg;
    render();
  }

  addLog(chalk.green(`Registered to game successfully.`));

  // 3. Game loop (interruptible by user keypress)
  global.isBotRunning = true;
  while (global.isBotRunning) {
    const stateRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/state`, {
      headers: { 'X-API-Key': API_KEY }
    });

    if (!stateRes.ok) {
      setError(`Failed to fetch state: ${stateRes.statusText}`);
      await sleepAndCheck(5000);
      continue;
    }

    const { data: state } = await stateRes.json();
    currentState = state;
    lastError = null; // clear error on success
    render();

    if (!state.self.isAlive) {
      addLog(chalk.red('Agent died...'));
      break;
    }
    if (state.gameStatus === 'finished') {
      addLog(chalk.green(`Game over. Winner? ${state.result?.isWinner ? 'Yes' : 'No'} | Rewards: ${state.result?.rewards}`));
      break;
    }

    const { self, currentRegion, visibleItems } = state;

    // === FREE ACTIONS ===
    for (const entry of visibleItems || []) {
      if (entry.regionId === self.regionId) {
        addLog(chalk.gray(`Attempting pickup: item ${entry.item?.name || entry.item?.id}`));
        const pickupRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
          body: JSON.stringify({ type: 'pickup', itemId: entry.item.id })
        });
        if (pickupRes.ok) {
          const resData = await pickupRes.json();
          addLog(chalk.yellow(`Picked up item! ${resData.message || ''}`));
        }
      }
    }

    // === MAIN ACTION ===
    const action = decideAction(state);

    const actionRes = await fetch(`${BASE_URL}/games/${GAME_ID}/agents/${AGENT_ID}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify(action)
    });

    if (actionRes.ok) {
      const result = await actionRes.json();
      addLog(`${chalk.cyan(action.type)} - ${result.message || ''}`);
    } else {
      setError(`Action failed: ${actionRes.statusText}`);
    }

    // Replaced standard 60s timeout with interruptible sleep check
    await sleepAndCheck(60000);
  }
}

async function startBot(API_KEY, WALLET_ADDRESS) {
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


  await mainMenu();
}

async function createAccount() {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'botName', message: 'Enter Bot Name:' }
  ]);

  // Generate a real EVM wallet
  const wallet = ethers.Wallet.createRandom();
  const walletAddress = wallet.address;
  const privateKey = wallet.privateKey;
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

    // Format: API_KEY||WALLET_ADDRESS||PRIVATE_KEY|
    const line = `${apiKey}||${walletAddress}||${wallet.privateKey}|`;
    fs.appendFileSync(ACCOUNTS_FILE, line + '\n');

    console.log(chalk.cyan(`Saved to ${ACCOUNTS_FILE} successfully.`));
    console.log(chalk.yellow(`⚠ Please backup the Private Key securely if you plan to use this EVM wallet!\n`));
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
    // Expected strict format: API_KEY||WALLET_ADDRESS||PRIVATE_KEY|
    const parts = line.split('||');
    const api_key = parts[0];
    const rawWallet = parts[1] ? parts[1].replace('|', '') : '';

    // Obscure wallet & key
    const displayWallet = rawWallet ? `${rawWallet.substring(0, 6)}...${rawWallet.substring(rawWallet.length - 4)}` : 'Unknown';
    const displayKey = api_key.length > 10 ? `${api_key.substring(0, 8)}...${api_key.substring(api_key.length - 4)}` : api_key;

    const choiceName = `🧑‍🚀 Agent: ${chalk.green(displayWallet)}  🔑 Key: ${chalk.yellow(displayKey)}`;

    return { name: choiceName, value: { api_key, wallet: rawWallet } };
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
  console.log(chalk.cyan.bold('╔════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║') + chalk.yellow.bold('          MOLTY ROYALE CLI BOT          ') + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════╝\n'));
  checkAccounts();
  await mainMenu();
}

start();
