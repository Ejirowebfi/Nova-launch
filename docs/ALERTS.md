# Alert Configuration Guide

## Alert Types

### 1. Critical Alerts

**Gas Cost Increase > 20%**
- Triggers when gas costs spike significantly
- Immediate notification required
- Investigate optimization regressions

**Regression Detected**
- Gas higher than before optimization
- Indicates failed optimization or new issues
- Review recent deployments

### 2. Warning Alerts

**Gas Cost Increase > 10%**
- Moderate increase detected
- Monitor closely
- Plan optimization if trend continues

**Anomaly Detected**
- Statistical outlier (z-score > 3)
- May indicate measurement error or real issue
- Verify with additional measurements

### 3. Info Alerts

**Optimization Deployed**
- New optimization went live
- Track impact over next few days
- Verify expected savings

**Monthly Report Ready**
- Report generated successfully
- Review and share with team

## Configuration

### Environment Variables

```env
# Alert thresholds
ALERT_THRESHOLD_INCREASE=20        # Critical threshold (%)
ALERT_WARNING_THRESHOLD=10         # Warning threshold (%)
ALERT_REGRESSION_THRESHOLD=5       # Regression sensitivity (%)

# Notification channels
ALERT_EMAIL=your-email@example.com
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK
```

### Threshold Customization

Edit `src/alerts/AlertSystem.js`:

```javascript
this.thresholds = {
  criticalIncrease: 20,    // Adjust as needed
  warningIncrease: 10,     // Adjust as needed
  regressionThreshold: 5   // Adjust as needed
};
```

## Notification Channels

### Slack Integration

1. Create Slack webhook
2. Add to `.env`:
```env
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

3. Test:
```bash
npm run alert
```

### Email Notifications

Configure email settings in `.env`:
```env
ALERT_EMAIL=team@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Discord Integration

Add Discord webhook:
```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK
```

## Alert Conditions

### Gas Increase Check
```javascript
if (increase > criticalIncrease) {
  // Send critical alert
} else if (increase > warningIncrease) {
  // Send warning alert
}
```

### Regression Check
```javascript
if (currentGas > optimizationBaseline) {
  // Optimization failed or regressed
}
```

### Anomaly Detection
```javascript
const zScore = (current - mean) / stdDev;
if (zScore > 3) {
  // Statistical anomaly detected
}
```

## Alert Schedule

### Automated Checks

```javascript
// Every 6 hours
cron.schedule('0 */6 * * *', checkAlerts);

// After each measurement
cron.schedule('0 2 * * *', async () => {
  await measure();
  await checkAlerts();
});
```

### Manual Check
```bash
npm run alert
```

## Alert Response

### Critical Alert Response

1. **Immediate Investigation**
   - Check recent deployments
   - Review code changes
   - Analyze measurement data

2. **Rollback if Needed**
   - Revert problematic changes
   - Deploy previous version
   - Re-measure to confirm

3. **Root Cause Analysis**
   - Identify cause
   - Document findings
   - Plan fix

### Warning Alert Response

1. **Monitor Trend**
   - Track over next 24-48 hours
   - Take additional measurements
   - Compare with historical data

2. **Plan Optimization**
   - If trend continues, prioritize optimization
   - Identify affected functions
   - Estimate impact

## Alert History

View past alerts:
```bash
cat data/alerts/2024-02-24.json
```

Alert log format:
```json
[
  {
    "severity": "critical",
    "type": "gas_increase",
    "message": "Critical: Gas cost increased by 22.5%",
    "details": {
      "current": 122500,
      "previous": 100000,
      "increase": "22.5"
    },
    "timestamp": "2024-02-24T10:30:00.000Z"
  }
]
```

## Best Practices

1. **Set Appropriate Thresholds**
   - Too sensitive: Alert fatigue
   - Too lenient: Miss important issues
   - Adjust based on your needs

2. **Multiple Channels**
   - Use Slack for team visibility
   - Email for critical alerts
   - Dashboard for historical view

3. **Regular Review**
   - Weekly alert review
   - Adjust thresholds as needed
   - Update team on trends

4. **Document Responses**
   - Track how alerts were handled
   - Build response playbook
   - Share learnings

## Troubleshooting

### Alerts Not Sending

Check:
- Webhook URL is correct
- Network connectivity
- Alert thresholds configured
- Sufficient measurement data

### False Positives

Adjust:
- Increase thresholds
- Add measurement smoothing
- Filter outliers

### Missed Alerts

Review:
- Threshold too high
- Measurement frequency
- Alert conditions

## Integration Examples

### GitHub Actions
```yaml
- name: Check Gas Alerts
  run: npm run alert
  
- name: Fail on Critical
  run: |
    if grep -q "critical" data/alerts/*.json; then
      exit 1
    fi
```

### CI/CD Pipeline
```bash
# In your deployment script
npm run measure
npm run alert

# Check exit code
if [ $? -ne 0 ]; then
  echo "Gas regression detected!"
  exit 1
fi
```

## Next Steps

1. Configure notification channels
2. Set appropriate thresholds
3. Test alert system
4. Document response procedures
5. Train team on alert handling
