# Gas Measurement Guide

## Overview

The gas tracker measures CPU instructions and memory usage for contract functions using Soroban's simulation API.

## How It Works

1. **Transaction Building**: Creates unsigned transactions for each function
2. **Simulation**: Uses `simulateTransaction` to get gas costs without executing
3. **Data Collection**: Extracts CPU instructions and memory bytes
4. **Storage**: Saves measurements to JSON files

## Measured Functions

### create_stream
Creates a new payment stream.

**Expected Gas**: ~105,000 instructions

### withdraw
Withdraws available funds from a stream.

**Expected Gas**: ~85,000 instructions

### cancel_stream
Cancels an active stream.

**Expected Gas**: ~95,000 instructions

## Running Measurements

### Manual Measurement
```bash
npm run measure
```

### Automated Daily Measurement
```bash
npm run schedule
```

## Interpreting Results

### CPU Instructions
- **< 100k**: Excellent efficiency
- **100k - 200k**: Good performance
- **200k - 500k**: Acceptable
- **> 500k**: Needs optimization

### Memory Usage
- **< 2KB**: Minimal footprint
- **2KB - 10KB**: Normal usage
- **> 10KB**: High memory consumption

## Best Practices

1. Run measurements at the same time daily
2. Take multiple samples for accuracy
3. Compare against baseline measurements
4. Monitor trends over time
