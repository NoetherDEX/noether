#!/bin/bash

stellar contract invoke \
    --id CD4ZEYKAS6OICSECQDTRZU3GDIJYTJYO7UMRP6KULXPHOD6SXGNMHMMO \
    --source-account noether_admin \
    --network testnet \
    -- \
    initialize \
    --admin "$(stellar keys address noether_admin)" \
    --oracle_adapter CBDH7R4PBFHMN4AER74O4RG7VHUWUMFI67UKDIY6ISNQP4H5KFKMSBS4 \
    --vault CB2KKOV3DL3KCBIB272ITDUY3LIBD3RLMR3WZ2VAPNUZV3HIVKHT43SG \
    --usdc_token CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4 \
    --config '{"min_collateral":"100000000","max_leverage":10,"maintenance_margin_bps":100,"liquidation_fee_bps":500,"trading_fee_bps":10,"base_funding_rate_bps":1,"max_position_size":"1000000000000","max_price_staleness":60,"max_oracle_deviation_bps":100}'
