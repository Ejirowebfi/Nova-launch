# StellarService

The `StellarService` class provides the core functionality for deploying tokens on the Stellar blockchain using Soroban smart contracts.

## Usage

```typescript
import { StellarService } from './services';
import type { TokenDeployParams } from './types';

// Initialize service
const stellarService = new StellarService('testnet'); // or 'mainnet'

// Deploy a token
const params: TokenDeployParams = {
    name: 'My Token',
    symbol: 'MTK',
    decimals: 7,
    initialSupply: '1000000',
    adminWallet: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    metadata: {
        image: imageFile,
        description: 'My token description'
    }
};

const result = await stellarService.deployToken(params);
console.log('Token deployed at:', result.tokenAddress);
console.log('Transaction hash:', result.transactionHash);
```

## Methods

### `constructor(network?: 'testnet' | 'mainnet')`

Creates a new StellarService instance.

- **Parameters:**
  - `network` (optional): Network to connect to. Defaults to `'testnet'`.

### `deployToken(params: TokenDeployParams): Promise<DeploymentResult>`

Deploys a new token to the Stellar network.

- **Parameters:**
  - `params`: Token deployment parameters
    - `name`: Token name
    - `symbol`: Token symbol
    - `decimals`: Number of decimal places
    - `initialSupply`: Initial token supply
    - `adminWallet`: Admin wallet address
    - `metadata` (optional): Token metadata (image and description)

- **Returns:** Promise resolving to deployment result
  - `tokenAddress`: Deployed token contract address
  - `transactionHash`: Transaction hash
  - `totalFee`: Total fee paid (in stroops)
  - `timestamp`: Deployment timestamp

- **Throws:**
  - `Error` if Freighter wallet is not found
  - `Error` if transaction simulation fails
  - `Error` if transaction submission fails
  - `Error` if transaction confirmation times out

## Transaction Flow

1. **Get Source Account**: Fetches the account details from the network
2. **Build Contract Invocation**: Creates a contract call to `create_token`
3. **Calculate Fees**: Determines total fee (base + metadata if applicable)
4. **Build Transaction**: Constructs the Stellar transaction
5. **Simulate**: Simulates the transaction to ensure validity
6. **Prepare**: Assembles the transaction with simulation results
7. **Sign**: Requests signature from Freighter wallet
8. **Submit**: Submits the signed transaction to the network
9. **Confirm**: Polls for transaction confirmation (max 60 seconds)
10. **Parse Result**: Extracts the token address from the result

## Fee Structure

- **Base Fee**: 70,000,000 stroops (7 XLM)
- **Metadata Fee**: 30,000,000 stroops (3 XLM) - only if metadata is provided
- **Total**: 70 XLM or 100 XLM depending on metadata inclusion

## Error Handling

The service provides comprehensive error handling:

- Wallet connection errors
- Transaction simulation errors
- Network submission errors
- Confirmation timeout errors
- Result parsing errors

All errors are thrown with descriptive messages for easy debugging.

## Dependencies

- `@stellar/stellar-sdk`: Stellar SDK for blockchain interaction
- `@stellar/freighter-api`: Freighter wallet integration

## Testing

The service includes comprehensive unit tests with mocked dependencies. Run tests with:

```bash
npm test
```
