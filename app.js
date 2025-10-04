// Minimal ERC-20 DApp using ethers v6
// Team chain config
const TEAM_CHAIN = {
  chainIdHex: '0x7a6e',          // 31342 decimal → hex
  chainIdDec: 31342,
  chainName: 'DIDLab Team 06',
  rpcUrls: ['https://hh-06.didlab.org'],
  nativeCurrency: { name: 'DID', symbol: 'DID', decimals: 18 },
};

// Minimal ERC20 ABI
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const accountEl = $('account');
const chainIdEl = $('chainId');
const tNameEl = $('tName');
const tSymbolEl = $('tSymbol');
const tDecimalsEl = $('tDecimals');
const balanceEl = $('balance');

const btnConnect = $('btn-connect');
const btnSwitch  = $('btn-switch');
const btnRefresh = $('btn-refresh');
const btnLoad    = $('btn-load');
const btnAddAsset= $('btn-add-asset');
const btnTransfer= $('btn-transfer');

const tokenAddressInput = $('tokenAddress');
const toInput = $('to');
const amountInput = $('amount');
const txInfoEl = $('txInfo');

let provider, signer, userAddress, token, tokenDecimals = 18, tokenSymbol = '';

function log(msg) {
  console.log(msg);
  logEl.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
}

function ensureEth() {
  if (!window.ethereum) throw new Error('MetaMask not found. Install it and refresh.');
}

async function connectWallet() {
  ensureEth();
  provider = new ethers.BrowserProvider(window.ethereum);
  const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
  userAddress = ethers.getAddress(accs[0]);
  signer = await provider.getSigner();

  // Show chain id
  const net = await provider.getNetwork();
  chainIdEl.textContent = '0x' + Number(net.chainId).toString(16);

  // UI
  accountEl.textContent = userAddress;
  btnRefresh.disabled = false;

  // Auto switch if not on 0x7a6e
  if (Number(net.chainId) !== TEAM_CHAIN.chainIdDec) {
    await switchToTeamChain();
  }

  // React to account/chain changes
  ethereum.on?.('accountsChanged', () => location.reload());
  ethereum.on?.('chainChanged', () => location.reload());

  log('Connected.');
}

async function switchToTeamChain() {
  ensureEth();
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: TEAM_CHAIN.chainIdHex }],
    });
    log('Switched to DIDLab Team 06');
  } catch (err) {
    // If the chain is unknown, add it
    if (err?.code === 4902 || ('' + err?.message).includes('Unrecognized chain ID')) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: TEAM_CHAIN.chainIdHex,
          chainName: TEAM_CHAIN.chainName,
          rpcUrls: TEAM_CHAIN.rpcUrls,
          nativeCurrency: TEAM_CHAIN.nativeCurrency,
        }],
      });
      log('Chain added. Switching…');
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TEAM_CHAIN.chainIdHex }],
      });
    } else {
      throw err;
    }
  }

  // Update chain UI
  chainIdEl.textContent = TEAM_CHAIN.chainIdHex;
}

function saveTokenAddress(addr) {
  localStorage.setItem('tokenAddress', addr);
}

function getSavedTokenAddress() {
  return localStorage.getItem('tokenAddress') || '';
}

function isAddress(addr) {
  try { ethers.getAddress(addr); return true; } catch { return false; }
}

async function loadToken() {
  const addr = tokenAddressInput.value.trim();
  if (!isAddress(addr)) throw new Error('Invalid ERC-20 address.');

  if (!provider) provider = new ethers.BrowserProvider(window.ethereum);
  if (!signer) signer = await provider.getSigner();

  token = new ethers.Contract(addr, ERC20_ABI, signer);

  const [name, sym, dec] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
  ]);

  tokenDecimals = Number(dec);
  tokenSymbol = sym;
  tNameEl.textContent = name;
  tSymbolEl.textContent = sym;
  tDecimalsEl.textContent = String(dec);

  saveTokenAddress(addr);
  btnAddAsset.disabled = false;
  btnTransfer.disabled = false;

  // Start listening for Transfer events touching the user (refresh on match)
  token.on('Transfer', (from, to, value) => {
    if (!userAddress) return;
    const u = userAddress.toLowerCase();
    if (from.toLowerCase() === u || to.toLowerCase() === u) {
      refreshBalance().catch(console.error);
    }
  });

  await refreshBalance();
  log('Token loaded.');
}

async function refreshBalance() {
  if (!token || !userAddress) throw new Error('Connect and load token first.');
  const raw = await token.balanceOf(userAddress);
  const human = ethers.formatUnits(raw, tokenDecimals);
  balanceEl.textContent = `${human} ${tokenSymbol || ''}`.trim();
}

async function addTokenToWallet() {
  if (!token) throw new Error('Load token first.');
  const tokenAddress = await token.getAddress();
  const ok = await ethereum.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: tokenAddress,
        symbol: tokenSymbol || 'TKN',
        decimals: tokenDecimals || 18,
      },
    },
  });
  log(ok ? 'Token added in MetaMask.' : 'User dismissed add-token.');
}

async function doTransfer() {
  if (!token) throw new Error('Load token first.');
  const to = toInput.value.trim();
  if (!isAddress(to)) throw new Error('Invalid recipient address.');

  const amtStr = amountInput.value.trim();
  if (!amtStr || Number(amtStr) <= 0) throw new Error('Enter a positive amount.');

  const amount = ethers.parseUnits(amtStr, tokenDecimals);

  // Send transfer
  const tx = await token.transfer(to, amount);
  txInfoEl.textContent = `Sent. Hash: ${tx.hash}`;
  log({ submitting: tx.hash });

  const rcpt = await tx.wait();
  const gasUsed = rcpt.gasUsed?.toString?.() ?? String(rcpt.gasUsed);
  txInfoEl.textContent =
    `✅ Mined in block ${rcpt.blockNumber}\n` +
    `Tx: ${rcpt.hash}\n` +
    `Gas used: ${gasUsed}`;
  await refreshBalance();
}

// Wire up UI
window.addEventListener('DOMContentLoaded', async () => {
  tokenAddressInput.value = getSavedTokenAddress();
  if (window.ethereum) {
    btnConnect.addEventListener('click', () => connectWallet().catch(e => log(e.message || e)));
    btnSwitch.addEventListener('click', () => switchToTeamChain().catch(e => log(e.message || e)));
    btnRefresh.addEventListener('click', () => refreshBalance().catch(e => log(e.message || e)));
    btnLoad.addEventListener('click', () => loadToken().catch(e => log(e.message || e)));
    btnAddAsset.addEventListener('click', () => addTokenToWallet().catch(e => log(e.message || e)));
    btnTransfer.addEventListener('click', () => doTransfer().catch(e => log(e.message || e)));
  } else {
    log('MetaMask not found. Install it: https://metamask.io');
  }
});
