# Stellar Token Deployer

A user-friendly dApp for quick token deployment on Stellar.

## Project Structure

```
.
├── contracts/          # Soroban smart contracts
│   └── token-factory/  # Token factory contract
└── frontend/           # React + TypeScript frontend
    └── src/
        ├── components/ # React components
        ├── services/   # API services
        ├── hooks/      # Custom React hooks
        ├── types/      # TypeScript types
        └── utils/      # Utility functions
```

## Getting Started

### Prerequisites

- Rust and Cargo
- Soroban CLI
- Node.js 18+
- npm or yarn

### Smart Contract Development

```bash
cd contracts/token-factory
cargo build --target wasm32-unknown-unknown --release
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Copy `frontend/.env.example` to `frontend/.env` and configure:

- `VITE_FACTORY_CONTRACT_ID`: Deployed factory contract address
- `VITE_NETWORK`: `testnet` or `mainnet`
- `VITE_IPFS_API_KEY`: Pinata API key
- `VITE_IPFS_API_SECRET`: Pinata API secret

## Testing

### Contract Tests
```bash
cd contracts/token-factory
cargo test
```

### Frontend Tests
```bash
cd frontend
npm test
```

## License

MIT
