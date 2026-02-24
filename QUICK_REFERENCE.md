# Gas Dashboard - Quick Reference

## Installation
```bash
cd gas-dashboard
npm install
cp .env.example .env
# Edit .env with your settings
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dashboard (dev mode) |
| `npm run build` | Build for production |
| `npm run measure` | Run gas measurement |
| `npm run alert` | Check for alerts |
| `npm run report` | Generate monthly report |
| `npm run schedule` | Start automated scheduler |

## Configuration

### Required Environment Variables
```env
CONTRACT_ID=your_contract_id
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ALERT_WEBHOOK_URL=your_slack_webhook
```

## Key Files

| File | Purpose |
|------|---------|
| `src/tracker/GasTracker.js` | Gas measurement logic |
| `src/alerts/AlertSystem.js` | Alert detection |
| `src/reports/ReportGenerator.js` | Report generation |
| `data/optimizations.json` | Optimization log |
| `data/benchmarks.json` | Competitor data |

## Alert Thresholds

- **Critical**: Gas increase >20%
- **Warning**: Gas increase >10%
- **Anomaly**: Z-score >3

## Scheduled Tasks

- **Daily measurement**: 2:00 AM
- **Alert check**: Every 6 hours
- **Monthly report**: 1st of month, 9:00 AM

## Dashboard Access

Development: `http://localhost:5173`

## Data Location

```
data/
├── measurements/  # Daily gas data
├── alerts/        # Alert history
└── reports/       # Monthly reports
```

## Support

- [Setup Guide](./docs/SETUP.md)
- [Measurement Guide](./docs/MEASUREMENT.md)
- [Alert Guide](./docs/ALERTS.md)
