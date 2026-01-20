'use client';

import { useState, useEffect } from 'react';
import { Landmark, TrendingUp, TrendingDown, ArrowRight, Info, Link2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Tabs, Badge, Tooltip } from '@/components/ui';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { formatUSD, formatNumber, formatPercent, fromPrecision, toPrecision, truncateAddress } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { setMarketContract, getMarketContract, updateOraclePrice } from '@/lib/stellar/vault';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { CONTRACTS } from '@/lib/utils/constants';
import type { Ticker } from '@/types';

function VaultPage() {
  const { isConnected, publicKey, xlmBalance, sign } = useWallet();

  // Pool stats (mock data for now)
  const [poolStats, setPoolStats] = useState({
    tvl: 1_250_000,
    glpPrice: 1.05,
    apy: 12.5,
    totalFees: 45_000,
    yourGlp: 0,
    yourValue: 0,
  });

  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Admin state
  const [isLinkingMarket, setIsLinkingMarket] = useState(false);
  const [currentMarketContract, setCurrentMarketContract] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState(false);

  // Oracle update state
  const [isUpdatingOracle, setIsUpdatingOracle] = useState(false);
  const [oracleError, setOracleError] = useState<string | null>(null);
  const [oracleSuccess, setOracleSuccess] = useState(false);

  // Live price state
  const [livePrices, setLivePrices] = useState<Record<string, Ticker>>({});
  const [isPricesLoading, setIsPricesLoading] = useState(true);

  // Fetch live prices from Binance
  useEffect(() => {
    const fetchPrices = async () => {
      setIsPricesLoading(true);
      try {
        const [xlmTicker, btcTicker, ethTicker] = await Promise.all([
          fetchTicker('XLM'),
          fetchTicker('BTC'),
          fetchTicker('ETH'),
        ]);
        setLivePrices({
          XLM: xlmTicker,
          BTC: btcTicker,
          ETH: ethTicker,
        });
      } catch (error) {
        console.error('Failed to fetch prices:', error);
      } finally {
        setIsPricesLoading(false);
      }
    };

    fetchPrices();
    // Refresh prices every 30 seconds
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch pool data
  useEffect(() => {
    const fetchPoolData = async () => {
      // TODO: Fetch from contract
      // const poolInfo = await getPoolInfo(publicKey);
      // const glpBalance = await getGlpBalance(publicKey, publicKey);

      // Fetch current market contract address
      if (publicKey) {
        const marketAddr = await getMarketContract(publicKey);
        setCurrentMarketContract(marketAddr);
      }
    };

    if (isConnected && publicKey) {
      fetchPoolData();
    }
  }, [isConnected, publicKey]);

  // Handle linking market contract to vault
  const handleLinkMarket = async () => {
    if (!publicKey) return;

    setIsLinkingMarket(true);
    setLinkError(null);
    setLinkSuccess(false);

    try {
      await setMarketContract(publicKey, sign);
      setCurrentMarketContract(CONTRACTS.MARKET);
      setLinkSuccess(true);
    } catch (error) {
      console.error('Failed to link market:', error);
      setLinkError(error instanceof Error ? error.message : 'Failed to link market contract');
    } finally {
      setIsLinkingMarket(false);
    }
  };

  // Handle updating oracle price (fixes Error #206 - stale price)
  const handleUpdateOracle = async () => {
    if (!publicKey) return;

    // Check if we have live prices
    if (isPricesLoading || Object.keys(livePrices).length === 0) {
      setOracleError('Waiting for live prices to load...');
      return;
    }

    setIsUpdatingOracle(true);
    setOracleError(null);
    setOracleSuccess(false);

    try {
      // Update all supported assets with live prices
      const assets = ['XLM', 'BTC', 'ETH'];
      for (const asset of assets) {
        const ticker = livePrices[asset];
        if (ticker) {
          console.log(`Updating ${asset} price to $${ticker.price}`);
          await updateOraclePrice(publicKey, sign, asset, ticker.price);
        }
      }
      setOracleSuccess(true);
    } catch (error) {
      console.error('Failed to update oracle:', error);
      setOracleError(error instanceof Error ? error.message : 'Failed to update oracle price');
    } finally {
      setIsUpdatingOracle(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || !isConnected) return;

    setIsDepositing(true);
    try {
      // TODO: Call deposit contract
      console.log('Depositing:', depositAmount);
      setDepositAmount('');
    } catch (error) {
      console.error('Deposit failed:', error);
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || !isConnected) return;

    setIsWithdrawing(true);
    try {
      // TODO: Call withdraw contract
      console.log('Withdrawing:', withdrawAmount);
      setWithdrawAmount('');
    } catch (error) {
      console.error('Withdraw failed:', error);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const depositNum = parseFloat(depositAmount) || 0;
  const glpToReceive = depositNum / poolStats.glpPrice;
  const depositFee = depositNum * 0.003; // 0.3%

  const withdrawNum = parseFloat(withdrawAmount) || 0;
  const xlmToReceive = withdrawNum * poolStats.glpPrice * 0.997; // After 0.3% fee

  return (
    <div className="min-h-screen bg-[#09090b]">
      <Header />

      <main className="pt-16">
        <div className="max-w-6xl mx-auto p-4 lg:p-6">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 mb-6">
              <Landmark className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white mb-4">
              Liquidity Vault
            </h1>
            <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
              Earn yield by providing liquidity. GLP holders act as the counterparty
              to traders and earn from trading fees and trader losses.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card className="text-center">
              <p className="text-sm text-neutral-500 mb-1">Total Value Locked</p>
              <p className="text-2xl font-bold text-white">{formatUSD(poolStats.tvl)}</p>
            </Card>
            <Card className="text-center">
              <p className="text-sm text-neutral-500 mb-1">GLP Price</p>
              <p className="text-2xl font-bold text-white">{formatUSD(poolStats.glpPrice)}</p>
            </Card>
            <Card className="text-center">
              <p className="text-sm text-neutral-500 mb-1">Est. APY</p>
              <p className="text-2xl font-bold text-emerald-400">{poolStats.apy}%</p>
            </Card>
            <Card className="text-center">
              <p className="text-sm text-neutral-500 mb-1">Total Fees Earned</p>
              <p className="text-2xl font-bold text-white">{formatUSD(poolStats.totalFees)}</p>
            </Card>
          </div>

          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Deposit Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Deposit
                  <Badge variant="success" size="sm">Earn {poolStats.apy}% APY</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-neutral-400">Amount</span>
                      {isConnected && (
                        <button
                          onClick={() => setDepositAmount(Math.floor(xlmBalance * 0.95).toString())}
                          className="text-xs text-neutral-500 hover:text-white transition-colors"
                        >
                          Max: {formatNumber(xlmBalance)} XLM
                        </button>
                      )}
                    </div>
                    <Input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0.00"
                      suffix="XLM"
                      className="text-right text-xl"
                    />
                  </div>

                  <div className="p-4 bg-white/5 rounded-xl space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">You will receive</span>
                      <span className="text-white font-medium">
                        {formatNumber(glpToReceive, 4)} GLP
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Fee (0.3%)</span>
                      <span className="text-neutral-300">
                        {formatNumber(depositFee)} XLM
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="success"
                    size="lg"
                    className="w-full"
                    onClick={handleDeposit}
                    disabled={!isConnected || depositNum <= 0}
                    isLoading={isDepositing}
                  >
                    {!isConnected ? 'Connect Wallet' : 'Deposit'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Withdraw Card */}
            <Card>
              <CardHeader>
                <CardTitle>Withdraw</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-neutral-400">GLP Amount</span>
                      {isConnected && poolStats.yourGlp > 0 && (
                        <button
                          onClick={() => setWithdrawAmount(poolStats.yourGlp.toString())}
                          className="text-xs text-neutral-500 hover:text-white transition-colors"
                        >
                          Max: {formatNumber(poolStats.yourGlp)} GLP
                        </button>
                      )}
                    </div>
                    <Input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="0.00"
                      suffix="GLP"
                      className="text-right text-xl"
                    />
                  </div>

                  <div className="p-4 bg-white/5 rounded-xl space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">You will receive</span>
                      <span className="text-white font-medium">
                        {formatNumber(xlmToReceive)} XLM
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Fee (0.3%)</span>
                      <span className="text-neutral-300">
                        {formatNumber(withdrawNum * poolStats.glpPrice * 0.003)} XLM
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="lg"
                    className="w-full"
                    onClick={handleWithdraw}
                    disabled={!isConnected || withdrawNum <= 0 || withdrawNum > poolStats.yourGlp}
                    isLoading={isWithdrawing}
                  >
                    {!isConnected ? 'Connect Wallet' : 'Withdraw'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Your Position */}
          {isConnected && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Your Position</CardTitle>
              </CardHeader>
              <CardContent>
                {poolStats.yourGlp > 0 ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                      <p className="text-sm text-neutral-500 mb-1">GLP Balance</p>
                      <p className="text-xl font-semibold text-white">
                        {formatNumber(poolStats.yourGlp)} GLP
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500 mb-1">Value</p>
                      <p className="text-xl font-semibold text-white">
                        {formatUSD(poolStats.yourValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500 mb-1">Pool Share</p>
                      <p className="text-xl font-semibold text-white">
                        {formatPercent((poolStats.yourValue / poolStats.tvl) * 100)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-neutral-500 mb-1">Est. Daily Earnings</p>
                      <p className="text-xl font-semibold text-emerald-400">
                        {formatUSD((poolStats.yourValue * poolStats.apy / 100) / 365)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-neutral-400 mb-4">
                      You don&apos;t have any GLP tokens yet.
                    </p>
                    <p className="text-sm text-neutral-500">
                      Deposit XLM above to start earning yield.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* How it Works */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>How GLP Works</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="p-4 bg-white/5 rounded-xl">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-3">
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">Earn from Fees</h4>
                  <p className="text-sm text-neutral-400">
                    Every trade on Noether pays a 0.1% fee. This fee is distributed
                    proportionally to all GLP holders.
                  </p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center mb-3">
                    <ArrowRight className="w-5 h-5 text-amber-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">Counterparty to Traders</h4>
                  <p className="text-sm text-neutral-400">
                    When traders lose, GLP holders profit. When traders win,
                    GLP holders pay. Over time, the house edge favors LPs.
                  </p>
                </div>
                <div className="p-4 bg-white/5 rounded-xl">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
                    <Info className="w-5 h-5 text-blue-400" />
                  </div>
                  <h4 className="font-medium text-white mb-2">Flexible Withdrawals</h4>
                  <p className="text-sm text-neutral-400">
                    Withdraw your liquidity anytime. GLP tokens represent your
                    proportional share of the pool.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Admin Panel - Link Market Contract */}
          {isConnected && (
            <Card className="mt-6 border border-amber-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-400">
                  <AlertTriangle className="w-5 h-5" />
                  Admin Panel
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                    <h4 className="font-medium text-white mb-2 flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Link Market Contract
                    </h4>
                    <p className="text-sm text-neutral-400 mb-4">
                      The Vault must know the Market contract address to authorize settlement calls.
                      This is required before positions can be closed.
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-500">Current Market:</span>
                        <span className="text-white font-mono text-xs">
                          {currentMarketContract
                            ? truncateAddress(currentMarketContract, 8, 8)
                            : 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-500">Expected Market:</span>
                        <span className="text-white font-mono text-xs">
                          {truncateAddress(CONTRACTS.MARKET, 8, 8)}
                        </span>
                      </div>

                      {currentMarketContract === CONTRACTS.MARKET ? (
                        <div className="flex items-center gap-2 text-emerald-400 text-sm">
                          <Badge variant="success">Linked</Badge>
                          <span>Market contract is properly linked</span>
                        </div>
                      ) : (
                        <>
                          {linkError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                              {linkError}
                            </div>
                          )}
                          {linkSuccess && (
                            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400">
                              Market contract linked successfully!
                            </div>
                          )}
                          <Button
                            variant="primary"
                            onClick={handleLinkMarket}
                            disabled={isLinkingMarket}
                            isLoading={isLinkingMarket}
                            className="w-full"
                          >
                            <Link2 className="w-4 h-4 mr-2" />
                            {isLinkingMarket ? 'Linking...' : 'Link Market to Vault'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Update Oracle Price Section */}
                  <div className="p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
                    <h4 className="font-medium text-white mb-2 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Update Oracle Price
                    </h4>
                    <p className="text-sm text-neutral-400 mb-4">
                      Fix Error #206 (stale price) by updating the Mock Oracle with live Binance prices.
                    </p>

                    {/* Live Prices Display */}
                    <div className="p-3 bg-white/5 rounded-lg mb-4">
                      <p className="text-xs text-neutral-500 mb-2">Live Prices (from Binance)</p>
                      {isPricesLoading ? (
                        <div className="text-sm text-neutral-400">Loading prices...</div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-neutral-500">XLM:</span>{' '}
                            <span className="text-white font-medium">
                              {livePrices.XLM ? formatUSD(livePrices.XLM.price, 4) : '--'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500">BTC:</span>{' '}
                            <span className="text-white font-medium">
                              {livePrices.BTC ? formatUSD(livePrices.BTC.price, 0) : '--'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-500">ETH:</span>{' '}
                            <span className="text-white font-medium">
                              {livePrices.ETH ? formatUSD(livePrices.ETH.price, 0) : '--'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {oracleError && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                          {oracleError}
                        </div>
                      )}
                      {oracleSuccess && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400">
                          Oracle prices updated successfully! (XLM, BTC, ETH)
                        </div>
                      )}
                      <Button
                        variant="secondary"
                        onClick={handleUpdateOracle}
                        disabled={isUpdatingOracle || isPricesLoading}
                        isLoading={isUpdatingOracle}
                        className="w-full"
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {isPricesLoading
                          ? 'Waiting for prices...'
                          : isUpdatingOracle
                          ? 'Updating...'
                          : 'Update Oracle Prices'}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function VaultPageWrapper() {
  return (
    <WalletProvider>
      <VaultPage />
    </WalletProvider>
  );
}
