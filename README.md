# Molty Royale - CLI Bot Manager 🤖🎮

<img width="809" height="501" alt="Molty Royale CLI" src="https://github.com/user-attachments/assets/93899914-fe0a-4646-8ff6-61b619a60717" />

A modern, interactive Command Line Interface (CLI) built with Node.js to manage accounts and automate gameplay for **Molty Royale**.

![Dependencies](https://img.shields.io/badge/dependencies-inquirer%20%7C%20chalk-blue)
![Platform](https://img.shields.io/badge/platform-Node.js-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## ✨ Features

- **Interactive Menu**: Beautiful, easy-to-use menu system powered by `inquirer` and `chalk`.
- **Account Management**: Create new Molty Royale accounts directly from the CLI. 
- **Auto-Play Agent**: Fully automated bot loop to queue for games, register agents, and execute strategies based on game state.
- **Auto-Save functionality**: API keys and wallet addresses are securely stored locally in `accounts.txt`.
- **Graceful Shutdown**: Press `s` or `q` to safely pause the bot without forcefully killing the terminal process.
- **Smart Strategy**: The bot intelligently makes decisions (explore, move out of death zones, use health items, attack monsters/agents) based on real-time API game state.

## 🚀 Prerequisites

Before you begin, ensure you have met the following requirements:
- **Node.js**: Recommended `v18.0.0` or higher.
- **npm** or **yarn** package manager.

## 🛠️ Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/airdrop-888/moltyRoyale-Bot.git
   cd moltyRoyale-Bot
   ```

2. Install the required dependencies:
   ```bash
   npm install
   ```

## 🎮 Usage

Run the script using Node.js:

```bash
npm start
```

### Main Menu Options

1. **Create Account**:
   - Prompts you for a "Bot Name" and "Wallet Address".
   - Generates a new account via the Molty Royale API.
   - Saves your credentials automatically to `accounts.txt`.

2. **Play Agent**:
   - Displays a list of your saved accounts.
   - Choose a wallet, and the bot will begin queueing and playing games.
   - During gameplay, press `s` or `q` anytime to stop the bot and return to the main menu.

3. **Exit**:
   - Closes the CLI application safely.

## 📁 File Structure

```text
moltyRoyale-Bot/
├── index.js           # Main application script & Bot strategy
├── package.json       # Node.js dependencies
└── accounts.txt       # Automatically generated (ignored by Git)
```

## 📜 Disclaimer

This project is intended for educational purposes only. Use responsibly and adhere to Molty Royale's terms of service. The developers are not responsible for any account suspensions or bans.

---

*Made with ❤️ for the Molty Royale community.*
