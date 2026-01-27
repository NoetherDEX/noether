#!/bin/bash

stellar contract invoke \
    --id CB2KKOV3DL3KCBIB272ITDUY3LIBD3RLMR3WZ2VAPNUZV3HIVKHT43SG \
    --source-account noether_admin \
    --network testnet \
    -- \
    set_market_contract \
    --new_market CD4ZEYKAS6OICSECQDTRZU3GDIJYTJYO7UMRP6KULXPHOD6SXGNMHMMO
