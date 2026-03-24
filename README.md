# ReactRaffle 🎟️

> **Autonomous on-chain raffles powered by Somnia Reactivity — prizes land in the same block as the draw.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-ReactRaffle-7C3AED?style=for-the-badge)](https://luckydraw-2ddz.vercel.app)
[![YouTube](https://img.shields.io/badge/Demo%20Video-YouTube-FF0000?style=for-the-badge&logo=youtube)](YOUR_YOUTUBE_LINK)
[![GitHub](https://img.shields.io/badge/Source-GitHub-181717?style=for-the-badge&logo=github)](https://github.com/Agihtaws/Luckydraw)


---

## What is ReactRaffle?

ReactRaffle is a fully autonomous raffle platform built on Somnia. An admin creates a campaign once, funds a prize pool, and walks away. The blockchain handles everything else — opening rounds, accepting entries, selecting winners, sending prizes, and scheduling the next round — forever, without any human intervention.

Winners receive STT in the **same block** as the draw. No waiting, no claiming, no trust required. Every draw is verifiable on-chain.

---

## How It Works

```
Admin creates campaign → locks prize pool on-chain
        ↓
Somnia Schedule subscription fires at open time
        ↓
Round opens automatically — players enter
        ↓
Somnia Schedule subscription fires at draw time
        ↓
Winner selected using on-chain randomness
        ↓
Prize sent to winner in the same transaction
        ↓
Next round scheduled automatically → repeats
```

The key technology is **Somnia Reactivity** — a system that lets smart contracts subscribe to future events and react to them autonomously. The contract literally schedules its own next action without any off-chain trigger.

---

## Features

- **Fully autonomous** — zero human action needed after campaign creation
- **Same-block prizes** — winner receives STT in the same block as the draw
- **Recurring rounds** — configurable repeat intervals (10 min, hourly, daily, weekly)
- **Multi-round funding** — fund multiple rounds upfront, top up anytime
- **Free or paid entry** — configurable entry fee per campaign
- **Prize modes** — equal split or tiered (1st gets more)
- **Cooldown option** — previous round winner cannot win again next round
- **Discord integration** — automatic announcements for every raffle event
- **Live frontend** — real-time countdown, entry list, winner reveal, past rounds history
- **Admin controls** — stop campaigns anytime with full pool refund
- **Verifiable randomness** — blockhash-based, fully on-chain

---

## Tech Stack

| Layer | Tech |
|---|---|
| Smart contract | Solidity 0.8.20, Hardhat, OpenZeppelin |
| Blockchain | Somnia Testnet (Chain ID: 50312) |
| Reactivity | Somnia Schedule subscriptions via `ISomniaReactivityPrecompile` |
| Frontend | React + Vite + Tailwind CSS |
| Wallet | RainbowKit + wagmi + viem |
| Backend | Node.js + Express + Somnia Reactivity SDK |
| Announcements | Discord webhook API |
| Data layer | Somnia Data Streams SDK |

---

## Project Structure

```
reactraffle/
├── contracts/                    Smart contract + Hardhat scripts
│   ├── RaffleEngine.sol          Core autonomous raffle contract
│   ├── IRaffleEngine.sol         Interface, structs, events, errors
│   ├── interfaces/
│   │   └── ISomniaReactivityPrecompile.sol
│   ├── scripts/
│   │   ├── deploy.js             Deploy + fund + verify on explorer
│   │   ├── enter.js              Enter wallets into active round
│   │   └── recoverBuffer.js      Recover STT from old deployments
│   └── hardhat.config.js
│
├── backend/                      Node.js event listener + REST API
│   └── src/
│       ├── index.js              Entry point
│       ├── api.js                Express API — webhook config endpoint
│       ├── chain.js              viem HTTP + WebSocket clients
│       ├── discord.js            Discord webhook message templates
│       ├── reactivity.js         Somnia WebSocket event subscription
│       └── streams.js            Somnia Data Streams publisher
│
└── frontend/                     React frontend
    └── src/
        ├── App.jsx               Router + layout
        ├── config/wagmi.js       wagmi + RainbowKit config
        ├── abi.js                RaffleEngine ABI
        ├── hooks/
        │   ├── useRaffle.js      Contract read hooks
        │   ├── useCampaign.js    Campaign details
        │   ├── useWallet.js      Wallet fetching
        │   └── useCountdown.js   Live countdown timer
        ├── components/
        │   ├── Navbar.jsx        Nav + mobile sidebar
        │   ├── CampaignCard.jsx  Card with stats + countdown + last winner
        │   ├── StatusBadge.jsx   Upcoming / Active / Ended badge
        │   └── RaffleSpinner.jsx Slot machine draw animation
        └── pages/
            ├── HomePage.jsx      Campaign grid with filter tabs
            ├── CampaignPage.jsx  Entry page + winners + past rounds
            ├── AdminPage.jsx     Create + top up + cancel campaigns
            └── HistoryPage.jsx   All completed rounds + verification
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- STT tokens from the [Somnia faucet](https://testnet.somnia.network)
- WalletConnect project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com)

### Clone the repo

```bash
git clone YOUR_GITHUB_LINK
cd reactraffle
```

### 1. Smart Contract

```bash
cd contracts
npm install

.env
# Fill in: PRIVATE_KEY
```

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network somnia_testnet
```

The deploy script automatically deploys the contract, funds the 32 STT subscription buffer, saves the address to `deployed.json`, and verifies source code on Shannon Explorer.

### 2. Backend

```bash
cd backend
npm install

.env
# Fill in: RPC_URL, WS_URL, PRIVATE_KEY, CONTRACT_ADDRESS,
#          BACKEND_SECRET, FRONTEND_URL, PORT
```

```bash
npm start
```

The backend starts on port 3001, opens a WebSocket subscription to the contract, and posts Discord messages for every raffle event.

### 3. Frontend

```bash
cd frontend
npm install

.env
# Fill in: VITE_CONTRACT_ADDRESS, VITE_DEPLOYER_ADDRESS,
#          VITE_WALLETCONNECT_PROJECT_ID,
#          VITE_BACKEND_URL, VITE_BACKEND_SECRET
```

```bash
npm run dev
```

Open `http://localhost:5173`. MetaMask will auto-prompt to add Somnia Testnet.

### 4. Run your first raffle

1. Connect the deployer wallet → go to **Admin**
2. Set your Discord webhook URL → **Save to backend**
3. Fill in the campaign form → **Create & Fund**
4. The contract takes over — rounds open and close automatically

---

## Contract

**RaffleEngine:** `0x155bf4A7B361b8263b43c71919033cd35aCeD0e0`

[View on Shannon Explorer →](https://shannon-explorer.somnia.network/address/0x155bf4A7B361b8263b43c71919033cd35aCeD0e0#code)

---

## Discord Announcements

The backend automatically posts to your Discord channel for every key event:

| Event | Message |
|---|---|
| Campaign created | 📢 New raffle — opens at [time] |
| 30 min before open | ⏰ Reminder — starts soon |
| Round opens | 🎟️ Raffle is LIVE — enter now! |
| Winners selected | 🏆 Winner announced — prize sent on-chain |
| Round rolled over | ↩️ No entries — pool carries forward |
| Campaign complete | 🏁 All rounds finished |

Configure the webhook URL from the Admin panel — no server restart needed.

---

## Environment Variables

### `contracts/.env`
```
PRIVATE_KEY=            # deployer wallet private key
```

### `backend/.env`
```
RPC_URL=https://dream-rpc.somnia.network
WS_URL=ws://api.infra.testnet.somnia.network/ws
PRIVATE_KEY=            # wallet for Data Streams writes
CONTRACT_ADDRESS=       # deployed RaffleEngine address
BACKEND_SECRET=         # shared secret with frontend
FRONTEND_URL=           # for CORS
PORT=3001
```

### `frontend/.env`
```
VITE_CONTRACT_ADDRESS=          # deployed RaffleEngine address
VITE_DEPLOYER_ADDRESS=          # admin wallet address
VITE_WALLETCONNECT_PROJECT_ID=  # from cloud.walletconnect.com
VITE_BACKEND_URL=http://localhost:3001
VITE_BACKEND_SECRET=            # same as backend BACKEND_SECRET
VITE_RPC_URL=https://dream-rpc.somnia.network
VITE_CHAIN_ID=50312
```

---

## Somnia Testnet

| Detail | Value |
|---|---|
| Network Name | Somnia Testnet |
| Chain ID | 50312 |
| Currency | STT |
| RPC URL | https://dream-rpc.somnia.network |
| Explorer | https://shannon-explorer.somnia.network |
| Faucet | https://testnet.somnia.network |

---