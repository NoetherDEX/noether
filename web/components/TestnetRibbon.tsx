/**
 * Small fixed badge distinguishing the public testnet deployment
 * (testnet.noether.exchange) from mainnet. Build-time flag: set
 * NEXT_PUBLIC_NETWORK_LABEL=testnet in that environment's build args;
 * absent → renders nothing (mainnet/staging unchanged).
 */
export function TestnetRibbon() {
  if (process.env.NEXT_PUBLIC_NETWORK_LABEL !== 'testnet') return null
  return (
    <div
      data-noether-chrome
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center"
    >
      <span className="rounded-b-md bg-[#eab308]/90 px-3 py-0.5 text-[11px] font-semibold tracking-wider text-black">
        TESTNET — funds are not real
      </span>
    </div>
  )
}
