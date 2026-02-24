# Gas Optimization Tracking Dashboard - Setup Guide

## Prerequisites

- Node.js 18+
- Stellar account with testnet XLM
- Deployed StellarStream contract

## Installation

```bash
cd gas-dashboard
npm install
```

## Configuration

1. Copy environment template:
```bash
cp .env.example .env
```

2. Configure `.env`:
```env
STELLAR_NETWORK=testnet
CONTRACT_ID=your_contract_id_here
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org

# Alert Configuration
ALERT_EMAIL=your-email@example.com
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
ALERT_THRESHOLD_INCREASE=20
```

3. Update contract parameters in `src/tracker/GasTracker.js`:
   - Replace placeholder addresses with real Stellar addresses
   - Adjust function parameters as needed

## Running the Dashboard

### Development Mode
```bash
npm run dev
```
Access at `http://localhost:5173`

### Production Build
```bash
npm run build
npm run preview
```

## Manual Operations

### Measure Gas Costs
```bash
npm run measure
```

### Check Alerts
```bash
npm run alert
```

### Generate Report
```bash
npm run report

# For specific month
node scripts/report.js 2024-01-01
```

## Automated Scheduling

Start the scheduler for automated measurements:
```bash
npm run schedule
```

This runs:
- Daily measurements at 2 AM
- Alert checks every 6 hours
- Monthly reports on the 1st at 9 AM

## Data Structure

```
data/
├── measurements/
│   ├── 2024-02-24.json
│   └── 2024-02-25.json
├── alerts/
│   └── 2024-02-24.json
├── reports/
│   ├── 2024-02.json
│   └── 2024-02.md
├── optimizations.json
└── benchmarks.json
```

## Slack Integration

1. Create a Slack webhook:
   - Go to https://api.slack.com/apps
   - Create new app
   - Enable Incoming Webhooks
   - Copy webhook URL

2. Add to `.env`:
```env
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Troubleshooting

### Contract Connection Issues
- Verify `CONTRACT_ID` is correct
- Check network connectivity
- Ensure RPC URL is accessible

### Measurement Failures
- Verify account has sufficient XLM
- Check contract is deployed
- Review function parameters

### Alert Not Sending
- Verify webhook URL
- Check network connectivity
- Review alert thresholds

## Next Steps

1. Run initial measurement: `npm run measure`
2. Start dashboard: `npm run dev`
3. Configure alerts
4. Set up automated scheduling
5. Generate first report

## Support

For issues, check:
- [Main README](../README.md)
- [Measurement Guide](./MEASUREMENT.md)
- [Alert Configuration](./ALERTS.md)
