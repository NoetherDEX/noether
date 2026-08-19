

<style>
.markdown-body table {min-width: 100%;width: 100%;display: table;}
thead {min-width: 100%;width: 100%;}
th {min-width: 60%;width: 60%;}
th:last-child {min-width: 20%;width: 20%;}
th:first-child {min-width: 20%;width: 20%;}
</style>



# Scout Report - Contracts - 2026-08-18

## Summary

| <span style="color:green">Crate</span> | <span style="color:green">Status</span> | <span style="color:green">Critical</span> | <span style="color:green">Medium</span> | <span style="color:green">Minor</span> | <span style="color:green">Enhancement</span> | 
| - | - | - | - | - | - | 
| market | Analyzed | 163 | 42 | 1 | 8 | 
| noeracle_shim | Analyzed | 5 | 1 | 0 | 5 | 
| noether_common | Analyzed | 22 | 0 | 0 | 1 | 
| noether_router | Analyzed | 8 | 16 | 0 | 11 | 
| referral | Analyzed | 1 | 0 | 0 | 6 | 
| risk | Analyzed | 12 | 5 | 0 | 4 | 
| vault | Analyzed | 61 | 5 | 0 | 5 | 
| vault_factory | Analyzed | 10 | 21 | 0 | 3 | 


Issues found:



- [Dos Unexpected Revert With Storage](#dos-unexpected-revert-with-storage) (34 results) (Medium)

- [Dynamic Storage](#dynamic-storage) (15 results) (Medium)

- [Unsafe Map Get](#unsafe-map-get) (13 results) (Medium)

- [Unsafe Unwrap](#unsafe-unwrap) (26 results) (Medium)

- [Soroban Version](#soroban-version) (51 results) (Enhancement)

- [Integer Overflow Or Underflow](#integer-overflow-or-underflow) (277 results) (Critical)



## DoS



### Dos Unexpected Revert With Storage

**Impact:** Medium

**Issue:** This storage (vector or map) operation is called without access control

**Description:**  It occurs by preventing transactions by other users from being successfully executed forcing the blockchain state to revert to its original state.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unexpected-revert-with-storage)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 29 | market | [storage.rs:457:22 - 457:31](market/src/storage.rs) |
| 34 | market | [storage.rs:571:22 - 571:31](market/src/storage.rs) |
| 41 | market | [storage.rs:880:13 - 880:22](market/src/storage.rs) |
| 45 | market | [storage.rs:897:21 - 897:30](market/src/storage.rs) |
| 52 | market | [trading.rs:47:11 - 47:20](market/src/trading.rs) |
| 53 | market | [trading.rs:81:21 - 81:30](market/src/trading.rs) |
| 65 | market | [lib.rs:422:26 - 422:35](market/src/lib.rs) |
| 124 | market | [lib.rs:1401:24 - 1401:27](market/src/lib.rs) |
| 247 | vault_factory | [storage.rs:147:10 - 147:19](vault_factory/src/storage.rs) |
| 250 | vault_factory | [storage.rs:220:10 - 220:19](vault_factory/src/storage.rs) |
| 254 | vault_factory | [storage.rs:233:18 - 233:27](vault_factory/src/storage.rs) |
| 256 | vault_factory | [storage.rs:246:10 - 246:19](vault_factory/src/storage.rs) |
| 260 | vault_factory | [storage.rs:259:18 - 259:27](vault_factory/src/storage.rs) |
| 282 | noether_router | [lib.rs:564:17 - 564:26](noether_router/src/lib.rs) |
| 287 | noether_router | [lib.rs:752:20 - 752:29](noether_router/src/lib.rs) |
| 409 | risk | [lib.rs:154:24 - 154:33](risk/src/lib.rs) |


### Dos Unbounded Operation

**Impact:** Medium

**Issue:** In order to prevent a single transaction from consuming all the gas in a block, unbounded operations must be avoided

**Description:** In order to prevent a single transaction from consuming all the gas in a block, unbounded operations must be avoided. This includes loops that do not have a bounded number of iterations, and recursive calls.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dos-unbounded-operation)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 33 | market | [storage.rs:568:5 - 573:6](market/src/storage.rs) |
| 40 | market | [storage.rs:873:5 - 878:6](market/src/storage.rs) |
| 44 | market | [storage.rs:894:5 - 899:6](market/src/storage.rs) |
| 48 | market | [position.rs:75:5 - 111:6](market/src/position.rs) |
| 56 | market | [trading.rs:107:5 - 109:6](market/src/trading.rs) |
| 59 | market | [trading.rs:122:5 - 127:6](market/src/trading.rs) |
| 63 | market | [lib.rs:418:9 - 426:10](market/src/lib.rs) |
| 64 | market | [lib.rs:450:9 - 459:10](market/src/lib.rs) |
| 123 | market | [lib.rs:1381:9 - 1403:10](market/src/lib.rs) |
| 148 | market | [lib.rs:1917:9 - 1927:10](market/src/lib.rs) |
| 149 | market | [lib.rs:1994:9 - 2005:10](market/src/lib.rs) |
| 253 | vault_factory | [storage.rs:230:5 - 235:6](vault_factory/src/storage.rs) |
| 259 | vault_factory | [storage.rs:256:5 - 261:6](vault_factory/src/storage.rs) |
| 263 | vault_factory | [lib.rs:97:13 - 102:14](vault_factory/src/lib.rs) |
| 272 | vault_factory | [lib.rs:942:5 - 945:6](vault_factory/src/lib.rs) |
| 273 | vault_factory | [lib.rs:946:5 - 952:6](vault_factory/src/lib.rs) |
| 281 | noether_router | [lib.rs:563:9 - 565:10](noether_router/src/lib.rs) |
| 286 | noether_router | [lib.rs:751:9 - 757:10](noether_router/src/lib.rs) |



## Resource Management



### Dynamic Storage

**Impact:** Medium

**Issue:** Using dynamic types in instance or persistent storage can lead to unnecessary growth or storage-related vulnerabilities.

**Description:** Using dynamic types in instance or persistent storage can lead to unnecessary growth or storage-related vulnerabilities.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/dynamic-storage)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 30 | market | [storage.rs:458:5 - 458:67](market/src/storage.rs) |
| 35 | market | [storage.rs:575:9 - 575:63](market/src/storage.rs) |
| 39 | market | [storage.rs:826:5 - 826:62](market/src/storage.rs) |
| 42 | market | [storage.rs:881:9 - 881:51](market/src/storage.rs) |
| 46 | market | [storage.rs:900:5 - 900:51](market/src/storage.rs) |
| 248 | vault_factory | [storage.rs:148:5 - 148:66](vault_factory/src/storage.rs) |
| 251 | vault_factory | [storage.rs:221:5 - 221:48](vault_factory/src/storage.rs) |
| 255 | vault_factory | [storage.rs:236:5 - 236:48](vault_factory/src/storage.rs) |
| 257 | vault_factory | [storage.rs:247:5 - 247:48](vault_factory/src/storage.rs) |
| 261 | vault_factory | [storage.rs:262:5 - 262:48](vault_factory/src/storage.rs) |
| 262 | vault_factory | [storage.rs:278:5 - 278:69](vault_factory/src/storage.rs) |
| 279 | noether_router | [lib.rs:229:9 - 229:72](noether_router/src/lib.rs) |
| 283 | noether_router | [lib.rs:566:9 - 566:66](noether_router/src/lib.rs) |
| 284 | noether_router | [lib.rs:579:9 - 581:55](noether_router/src/lib.rs) |
| 285 | noether_router | [lib.rs:611:9 - 611:72](noether_router/src/lib.rs) |



## Authorization



### Unsafe Map Get

**Impact:** Medium

**Issue:** Unsafe access on Map, method could panic.

**Description:** This vulnerability class pertains to the inappropriate usage of the get method for Map in soroban

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unsafe-map-get)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 71 | market | [lib.rs:534:60 - 534:85](market/src/lib.rs) |
| 138 | market | [lib.rs:1678:56 - 1678:81](market/src/lib.rs) |


### Unprotected Update Current Contract Wasm

**Impact:** Critical

**Issue:** This update_current_contract_wasm is called without access control

**Description:** If users are allowed to call update_current_contract_wasm, they can intentionally modify the contract behaviour, leading to the loss of all associated data/tokens and functionalities given by this contract or by others that depend on it. To prevent this, the function should be restricted to administrators or authorized users only.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unprotected-update-current-contract-wasm)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 236 | market | [lib.rs:303:9 - 303:67](market/src/lib.rs) |
| 243 | referral | [lib.rs:386:9 - 386:67](referral/src/lib.rs) |
| 277 | vault_factory | [lib.rs:854:9 - 854:67](vault_factory/src/lib.rs) |
| 312 | noether_router | [lib.rs:632:9 - 632:67](noether_router/src/lib.rs) |
| 383 | vault | [lib.rs:1169:9 - 1169:67](vault/src/lib.rs) |
| 394 | noeracle_shim | [lib.rs:280:9 - 280:67](noeracle_shim/src/lib.rs) |
| 415 | risk | [lib.rs:196:9 - 196:67](risk/src/lib.rs) |


### Missing New Admin Auth

**Impact:** Medium

**Issue:** New admin/owner address must sign before being stored

**Description:** When updating admin or owner, the incoming address should also sign to prevent accidental bricking due to a mistaken address.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/missing-new-admin-auth)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 301 | noether_router | [lib.rs:640:9 - 640:66](noether_router/src/lib.rs) |
| 378 | vault | [storage.rs:180:5 - 180:57](vault/src/storage.rs) |
| 389 | noeracle_shim | [lib.rs:270:9 - 270:66](noeracle_shim/src/lib.rs) |
| 411 | risk | [lib.rs:182:9 - 182:66](risk/src/lib.rs) |



## Error Handling



### Unsafe Unwrap

**Impact:** Medium

**Issue:** Unsafe usage of `unwrap`

**Description:** This vulnerability class pertains to the inappropriate usage of the unwrap method in Rust, which is commonly employed for error handling. The unwrap method retrieves the inner value of an Option or Result, but if an error or None occurs, it triggers a panic and crashes the program.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/unsafe-unwrap)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 24 | market | [storage.rs:218:5 - 218:59](market/src/storage.rs) |
| 25 | market | [storage.rs:226:5 - 226:67](market/src/storage.rs) |
| 26 | market | [storage.rs:234:5 - 234:59](market/src/storage.rs) |
| 27 | market | [storage.rs:242:5 - 242:63](market/src/storage.rs) |
| 32 | market | [storage.rs:569:22 - 569:54](market/src/storage.rs) |
| 43 | market | [storage.rs:895:18 - 895:37](market/src/storage.rs) |
| 47 | market | [position.rs:76:18 - 76:46](market/src/position.rs) |
| 58 | market | [trading.rs:123:20 - 123:41](market/src/trading.rs) |
| 61 | market | [lib.rs:419:22 - 419:41](market/src/lib.rs) |
| 62 | market | [lib.rs:451:22 - 451:42](market/src/lib.rs) |
| 132 | market | [lib.rs:1594:27 - 1594:48](market/src/lib.rs) |
| 144 | market | [lib.rs:1995:23 - 1995:51](market/src/lib.rs) |
| 145 | market | [lib.rs:2012:23 - 2012:44](market/src/lib.rs) |
| 146 | market | [lib.rs:2015:28 - 2015:53](market/src/lib.rs) |
| 147 | market | [lib.rs:2042:37 - 2042:60](market/src/lib.rs) |
| 252 | vault_factory | [storage.rs:231:18 - 231:38](vault_factory/src/storage.rs) |
| 258 | vault_factory | [storage.rs:257:18 - 257:38](vault_factory/src/storage.rs) |
| 271 | vault_factory | [lib.rs:943:57 - 943:82](vault_factory/src/lib.rs) |
| 288 | noether_router | [lib.rs:806:21 - 806:35](noether_router/src/lib.rs) |
| 314 | vault | [storage.rs:176:5 - 176:59](vault/src/storage.rs) |
| 315 | vault | [storage.rs:184:5 - 184:63](vault/src/storage.rs) |
| 316 | vault | [storage.rs:192:5 - 192:68](vault/src/storage.rs) |
| 317 | vault | [storage.rs:200:5 - 200:62](vault/src/storage.rs) |
| 407 | risk | [lib.rs:165:23 - 165:45](risk/src/lib.rs) |
| 408 | risk | [lib.rs:168:28 - 168:54](risk/src/lib.rs) |


### Unused Return Enum

**Impact:** Minor

**Issue:** If any of the variants (Ok/Err) is not used, the code could be simplified or it could imply a bug

**Description:** Soroban functions can return a Result enum with a custom error type. This is useful for the caller to know what went wrong when the message fails. The definition of the Result type enum consists of two variants: Ok and Err. If any of the variants is not used, the code could be simplified or it could imply a bug.    

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/unused-return-enum)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 217 | market | [lib.rs:3709:9 - 3709:15](market/src/lib.rs) |



## Best Practices



### Soroban Version

**Impact:** Enhancement

**Issue:** Use the latest version of Soroban

**Description:** Using a older version of Soroban can be dangerous, as it may have bugs or security issues. Use the latest version available.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/soroban-version)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 0 | noether_common | [lib.rs:1:1 - 1:1](noether_common/src/lib.rs) |
| 23 | market | [lib.rs:1:1 - 1:1](market/src/lib.rs) |
| 237 | referral | [lib.rs:1:1 - 1:1](referral/src/lib.rs) |
| 244 | vault_factory | [lib.rs:1:1 - 1:1](vault_factory/src/lib.rs) |
| 278 | noether_router | [lib.rs:1:1 - 1:1](noether_router/src/lib.rs) |
| 313 | vault | [lib.rs:1:1 - 1:1](vault/src/lib.rs) |
| 384 | noeracle_shim | [lib.rs:1:1 - 1:1](noeracle_shim/src/lib.rs) |
| 395 | risk | [lib.rs:1:1 - 1:1](risk/src/lib.rs) |


### Storage Change Events

**Impact:** Enhancement

**Issue:** Consider emiting an event when storage is modified

**Description:** Emiting an event when storage changes is a good practice to make the contracts more transparent and usable to its clients and observers

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/storage-change-events)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 229 | market | [lib.rs:1464:5 - 1464:89](market/src/lib.rs) |
| 230 | market | [lib.rs:274:5 - 274:92](market/src/lib.rs) |
| 231 | market | [lib.rs:288:5 - 288:81](market/src/lib.rs) |
| 232 | market | [lib.rs:327:5 - 327:81](market/src/lib.rs) |
| 233 | market | [lib.rs:3247:5 - 3250:36](market/src/lib.rs) |
| 234 | market | [lib.rs:315:5 - 315:86](market/src/lib.rs) |
| 235 | market | [lib.rs:1514:5 - 1514:95](market/src/lib.rs) |
| 238 | referral | [lib.rs:376:5 - 376:80](referral/src/lib.rs) |
| 239 | referral | [lib.rs:298:5 - 298:77](referral/src/lib.rs) |
| 240 | referral | [lib.rs:307:5 - 307:83](referral/src/lib.rs) |
| 241 | referral | [lib.rs:370:5 - 370:78](referral/src/lib.rs) |
| 242 | referral | [lib.rs:316:5 - 316:84](referral/src/lib.rs) |
| 275 | vault_factory | [lib.rs:835:5 - 835:93](vault_factory/src/lib.rs) |
| 276 | vault_factory | [lib.rs:843:5 - 843:74](vault_factory/src/lib.rs) |
| 302 | noether_router | [lib.rs:424:5 - 424:78](noether_router/src/lib.rs) |
| 303 | noether_router | [lib.rs:553:5 - 557:34](noether_router/src/lib.rs) |
| 304 | noether_router | [lib.rs:637:5 - 637:79](noether_router/src/lib.rs) |
| 305 | noether_router | [lib.rs:588:5 - 591:34](noether_router/src/lib.rs) |
| 306 | noether_router | [lib.rs:542:5 - 542:87](noether_router/src/lib.rs) |
| 307 | noether_router | [lib.rs:212:5 - 218:34](noether_router/src/lib.rs) |
| 308 | noether_router | [lib.rs:623:5 - 623:85](noether_router/src/lib.rs) |
| 309 | noether_router | [lib.rs:603:5 - 606:34](noether_router/src/lib.rs) |
| 310 | noether_router | [lib.rs:574:5 - 577:34](noether_router/src/lib.rs) |
| 311 | noether_router | [lib.rs:616:5 - 616:81](noether_router/src/lib.rs) |
| 379 | vault | [lib.rs:943:5 - 943:84](vault/src/lib.rs) |
| 380 | vault | [lib.rs:560:5 - 567:34](vault/src/lib.rs) |
| 381 | vault | [lib.rs:1064:5 - 1064:75](vault/src/lib.rs) |
| 382 | vault | [lib.rs:1074:5 - 1074:88](vault/src/lib.rs) |
| 390 | noeracle_shim | [lib.rs:235:5 - 235:90](noeracle_shim/src/lib.rs) |
| 391 | noeracle_shim | [lib.rs:247:5 - 252:34](noeracle_shim/src/lib.rs) |
| 392 | noeracle_shim | [lib.rs:116:5 - 120:34](noeracle_shim/src/lib.rs) |
| 393 | noeracle_shim | [lib.rs:267:5 - 267:79](noeracle_shim/src/lib.rs) |
| 412 | risk | [lib.rs:71:5 - 71:95](risk/src/lib.rs) |
| 413 | risk | [lib.rs:58:5 - 58:76](risk/src/lib.rs) |
| 414 | risk | [lib.rs:179:5 - 179:79](risk/src/lib.rs) |


### Avoid Vec Map Input

**Impact:** Medium

**Issue:** Avoid accepting soroban_sdk::Vec or Map parameters without validating their contents.

**Description:** Soroban Vec and Map<K, V> parameters arrive as raw Val values. Validate or normalize every element before storing or reusing them so a bad conversion does not halt contract execution.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/avoid-vec-map-input)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 274 | vault_factory | [lib.rs:835:43 - 835:64](vault_factory/src/lib.rs) |
| 295 | noether_router | [lib.rs:402:9 - 402:44](noether_router/src/lib.rs) |
| 296 | noether_router | [lib.rs:555:9 - 555:22](noether_router/src/lib.rs) |
| 297 | noether_router | [lib.rs:556:9 - 556:29](noether_router/src/lib.rs) |
| 298 | noether_router | [lib.rs:605:9 - 605:36](noether_router/src/lib.rs) |
| 299 | noether_router | [lib.rs:576:9 - 576:28](noether_router/src/lib.rs) |
| 300 | noether_router | [lib.rs:217:9 - 217:36](noether_router/src/lib.rs) |
| 410 | risk | [lib.rs:149:31 - 149:60](risk/src/lib.rs) |



## Arithmetic



### Integer Overflow Or Underflow

**Impact:** Critical

**Issue:** Potential for integer arithmetic overflow/underflow. Consider checked, wrapping or saturating arithmetic.

**Description:** An overflow/underflow is typically caught and generates an error. When it is not caught, the operation will result in an inexact result which could lead to serious problems.

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/soroban/integer-overflow-or-underflow)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 1 | noether_common | [math.rs:21:5 - 21:36](noether_common/src/math.rs) |
| 2 | noether_common | [math.rs:48:25 - 48:94](noether_common/src/math.rs) |
| 3 | noether_common | [math.rs:54:30 - 54:61](noether_common/src/math.rs) |
| 4 | noether_common | [math.rs:55:13 - 55:65](noether_common/src/math.rs) |
| 5 | noether_common | [math.rs:60:30 - 60:61](noether_common/src/math.rs) |
| 6 | noether_common | [math.rs:61:13 - 61:65](noether_common/src/math.rs) |
| 7 | noether_common | [math.rs:85:30 - 85:66](noether_common/src/math.rs) |
| 8 | noether_common | [math.rs:91:30 - 91:66](noether_common/src/math.rs) |
| 9 | noether_common | [math.rs:116:17 - 116:52](noether_common/src/math.rs) |
| 10 | noether_common | [math.rs:147:5 - 147:82](noether_common/src/math.rs) |
| 11 | noether_common | [math.rs:188:9 - 189:57](noether_common/src/math.rs) |
| 12 | noether_common | [math.rs:194:9 - 195:59](noether_common/src/math.rs) |
| 13 | noether_common | [math.rs:194:10 - 195:59](noether_common/src/math.rs) |
| 14 | noether_common | [math.rs:218:17 - 218:54](noether_common/src/math.rs) |
| 15 | noether_common | [math.rs:222:15 - 222:48](noether_common/src/math.rs) |
| 16 | noether_common | [math.rs:225:29 - 225:33](noether_common/src/math.rs) |
| 17 | noether_common | [math.rs:244:19 - 244:81](noether_common/src/math.rs) |
| 18 | noether_common | [math.rs:245:5 - 245:49](noether_common/src/math.rs) |
| 19 | noether_common | [math.rs:276:8 - 276:37](noether_common/src/math.rs) |
| 20 | noether_common | [math.rs:296:8 - 296:36](noether_common/src/math.rs) |
| 21 | noether_common | [math.rs:316:8 - 316:35](noether_common/src/math.rs) |
| 22 | noether_common | [math.rs:328:5 - 328:63](noether_common/src/math.rs) |
| 28 | market | [storage.rs:272:19 - 272:30](market/src/storage.rs) |
| 31 | market | [storage.rs:466:34 - 466:42](market/src/storage.rs) |
| 36 | market | [storage.rs:658:19 - 658:30](market/src/storage.rs) |
| 37 | market | [storage.rs:704:48 - 704:62](market/src/storage.rs) |
| 38 | market | [storage.rs:705:35 - 705:44](market/src/storage.rs) |
| 49 | market | [position.rs:90:17 - 90:26](market/src/position.rs) |
| 50 | market | [position.rs:92:54 - 92:63](market/src/position.rs) |
| 51 | market | [position.rs:105:22 - 105:74](market/src/position.rs) |
| 54 | market | [trading.rs:87:24 - 87:75](market/src/trading.rs) |
| 55 | market | [trading.rs:101:36 - 101:50](market/src/trading.rs) |
| 57 | market | [trading.rs:108:9 - 108:58](market/src/trading.rs) |
| 60 | market | [trading.rs:144:5 - 144:47](market/src/trading.rs) |
| 66 | market | [lib.rs:442:22 - 442:34](market/src/lib.rs) |
| 67 | market | [lib.rs:518:33 - 518:58](market/src/lib.rs) |
| 68 | market | [lib.rs:543:20 - 543:53](market/src/lib.rs) |
| 69 | market | [lib.rs:580:30 - 580:46](market/src/lib.rs) |
| 70 | market | [lib.rs:587:53 - 587:70](market/src/lib.rs) |
| 72 | market | [lib.rs:715:33 - 715:81](market/src/lib.rs) |
| 73 | market | [lib.rs:716:12 - 716:75](market/src/lib.rs) |
| 74 | market | [lib.rs:752:25 - 752:58](market/src/lib.rs) |
| 75 | market | [lib.rs:754:91 - 754:101](market/src/lib.rs) |
| 76 | market | [lib.rs:763:27 - 763:31](market/src/lib.rs) |
| 77 | market | [lib.rs:763:65 - 763:69](market/src/lib.rs) |
| 78 | market | [lib.rs:764:13 - 764:29](market/src/lib.rs) |
| 79 | market | [lib.rs:765:13 - 765:30](market/src/lib.rs) |
| 80 | market | [lib.rs:769:13 - 769:26](market/src/lib.rs) |
| 81 | market | [lib.rs:770:13 - 770:27](market/src/lib.rs) |
| 82 | market | [lib.rs:773:9 - 773:30](market/src/lib.rs) |
| 83 | market | [lib.rs:784:47 - 784:55](market/src/lib.rs) |
| 84 | market | [lib.rs:785:25 - 785:58](market/src/lib.rs) |
| 85 | market | [lib.rs:797:24 - 797:50](market/src/lib.rs) |
| 86 | market | [lib.rs:798:30 - 798:69](market/src/lib.rs) |
| 87 | market | [lib.rs:837:9 - 837:38](market/src/lib.rs) |
| 88 | market | [lib.rs:878:30 - 878:58](market/src/lib.rs) |
| 89 | market | [lib.rs:882:12 - 882:74](market/src/lib.rs) |
| 90 | market | [lib.rs:894:18 - 894:75](market/src/lib.rs) |
| 91 | market | [lib.rs:895:12 - 895:48](market/src/lib.rs) |
| 92 | market | [lib.rs:977:25 - 977:60](market/src/lib.rs) |
| 93 | market | [lib.rs:1022:31 - 1022:60](market/src/lib.rs) |
| 94 | market | [lib.rs:1026:38 - 1026:69](market/src/lib.rs) |
| 95 | market | [lib.rs:1039:17 - 1039:77](market/src/lib.rs) |
| 96 | market | [lib.rs:1040:34 - 1040:59](market/src/lib.rs) |
| 97 | market | [lib.rs:1046:16 - 1046:70](market/src/lib.rs) |
| 98 | market | [lib.rs:1047:35 - 1047:71](market/src/lib.rs) |
| 99 | market | [lib.rs:1052:26 - 1052:91](market/src/lib.rs) |
| 100 | market | [lib.rs:1053:34 - 1053:58](market/src/lib.rs) |
| 101 | market | [lib.rs:1055:28 - 1055:55](market/src/lib.rs) |
| 102 | market | [lib.rs:1056:34 - 1056:88](market/src/lib.rs) |
| 103 | market | [lib.rs:1064:32 - 1064:63](market/src/lib.rs) |
| 104 | market | [lib.rs:1116:31 - 1116:95](market/src/lib.rs) |
| 105 | market | [lib.rs:1120:30 - 1120:89](market/src/lib.rs) |
| 106 | market | [lib.rs:1121:30 - 1121:50](market/src/lib.rs) |
| 107 | market | [lib.rs:1122:26 - 1122:45](market/src/lib.rs) |
| 108 | market | [lib.rs:1128:32 - 1128:73](market/src/lib.rs) |
| 109 | market | [lib.rs:1135:66 - 1135:87](market/src/lib.rs) |
| 110 | market | [lib.rs:1159:74 - 1159:84](market/src/lib.rs) |
| 111 | market | [lib.rs:1165:21 - 1165:89](market/src/lib.rs) |
| 112 | market | [lib.rs:1166:66 - 1166:93](market/src/lib.rs) |
| 113 | market | [lib.rs:1183:28 - 1184:114](market/src/lib.rs) |
| 114 | market | [lib.rs:1184:69 - 1184:113](market/src/lib.rs) |
| 115 | market | [lib.rs:1251:16 - 1251:36](market/src/lib.rs) |
| 116 | market | [lib.rs:1258:29 - 1258:49](market/src/lib.rs) |
| 117 | market | [lib.rs:1258:66 - 1258:79](market/src/lib.rs) |
| 118 | market | [lib.rs:1267:25 - 1267:96](market/src/lib.rs) |
| 119 | market | [lib.rs:1268:32 - 1268:53](market/src/lib.rs) |
| 120 | market | [lib.rs:1271:34 - 1271:40](market/src/lib.rs) |
| 121 | market | [lib.rs:1272:28 - 1272:34](market/src/lib.rs) |
| 122 | market | [lib.rs:1276:13 - 1276:36](market/src/lib.rs) |
| 125 | market | [lib.rs:1395:20 - 1395:40](market/src/lib.rs) |
| 126 | market | [lib.rs:1417:18 - 1417:30](market/src/lib.rs) |
| 127 | market | [lib.rs:1418:41 - 1418:65](market/src/lib.rs) |
| 128 | market | [lib.rs:1435:20 - 1435:27](market/src/lib.rs) |
| 129 | market | [lib.rs:1445:22 - 1445:42](market/src/lib.rs) |
| 130 | market | [lib.rs:1446:9 - 1446:42](market/src/lib.rs) |
| 131 | market | [lib.rs:1471:22 - 1471:50](market/src/lib.rs) |
| 133 | market | [lib.rs:1587:32 - 1587:59](market/src/lib.rs) |
| 134 | market | [lib.rs:1588:32 - 1588:59](market/src/lib.rs) |
| 135 | market | [lib.rs:1601:36 - 1601:64](market/src/lib.rs) |
| 136 | market | [lib.rs:1680:32 - 1680:54](market/src/lib.rs) |
| 137 | market | [lib.rs:1693:27 - 1693:51](market/src/lib.rs) |
| 139 | market | [lib.rs:1778:45 - 1778:75](market/src/lib.rs) |
| 140 | market | [lib.rs:1797:32 - 1797:53](market/src/lib.rs) |
| 141 | market | [lib.rs:1859:13 - 1859:29](market/src/lib.rs) |
| 142 | market | [lib.rs:1859:25 - 1859:29](market/src/lib.rs) |
| 143 | market | [lib.rs:1862:13 - 1862:32](market/src/lib.rs) |
| 150 | market | [lib.rs:2057:13 - 2057:56](market/src/lib.rs) |
| 151 | market | [lib.rs:2059:17 - 2059:65](market/src/lib.rs) |
| 152 | market | [lib.rs:2061:13 - 2061:29](market/src/lib.rs) |
| 153 | market | [lib.rs:2068:35 - 2068:94](market/src/lib.rs) |
| 154 | market | [lib.rs:2074:38 - 2074:97](market/src/lib.rs) |
| 155 | market | [lib.rs:2075:38 - 2075:62](market/src/lib.rs) |
| 156 | market | [lib.rs:2076:21 - 2076:44](market/src/lib.rs) |
| 157 | market | [lib.rs:2090:21 - 2090:38](market/src/lib.rs) |
| 158 | market | [lib.rs:2091:21 - 2091:45](market/src/lib.rs) |
| 159 | market | [lib.rs:2094:21 - 2094:53](market/src/lib.rs) |
| 160 | market | [lib.rs:2110:31 - 2110:64](market/src/lib.rs) |
| 161 | market | [lib.rs:2152:9 - 2154:10](market/src/lib.rs) |
| 162 | market | [lib.rs:2153:46 - 2153:82](market/src/lib.rs) |
| 163 | market | [lib.rs:2183:25 - 2183:54](market/src/lib.rs) |
| 164 | market | [lib.rs:2184:26 - 2184:55](market/src/lib.rs) |
| 165 | market | [lib.rs:2187:13 - 2187:33](market/src/lib.rs) |
| 166 | market | [lib.rs:2190:13 - 2190:34](market/src/lib.rs) |
| 167 | market | [lib.rs:2201:24 - 2201:35](market/src/lib.rs) |
| 168 | market | [lib.rs:2294:12 - 2294:30](market/src/lib.rs) |
| 169 | market | [lib.rs:2301:13 - 2301:85](market/src/lib.rs) |
| 170 | market | [lib.rs:2314:20 - 2314:93](market/src/lib.rs) |
| 172 | market | [lib.rs:2391:12 - 2391:38](market/src/lib.rs) |
| 173 | market | [lib.rs:2905:13 - 2905:38](market/src/lib.rs) |
| 174 | market | [lib.rs:2907:13 - 2907:38](market/src/lib.rs) |
| 175 | market | [lib.rs:2910:13 - 2910:46](market/src/lib.rs) |
| 176 | market | [lib.rs:3026:44 - 3026:102](market/src/lib.rs) |
| 177 | market | [lib.rs:3027:45 - 3027:103](market/src/lib.rs) |
| 178 | market | [lib.rs:3076:12 - 3076:38](market/src/lib.rs) |
| 179 | market | [lib.rs:3290:22 - 3290:52](market/src/lib.rs) |
| 180 | market | [lib.rs:3295:9 - 3295:70](market/src/lib.rs) |
| 181 | market | [lib.rs:3335:54 - 3335:66](market/src/lib.rs) |
| 182 | market | [lib.rs:3335:76 - 3335:88](market/src/lib.rs) |
| 183 | market | [lib.rs:3336:28 - 3337:70](market/src/lib.rs) |
| 184 | market | [lib.rs:3355:29 - 3355:95](market/src/lib.rs) |
| 185 | market | [lib.rs:3356:30 - 3356:38](market/src/lib.rs) |
| 186 | market | [lib.rs:3357:30 - 3357:38](market/src/lib.rs) |
| 187 | market | [lib.rs:3399:27 - 3399:93](market/src/lib.rs) |
| 188 | market | [lib.rs:3418:32 - 3418:41](market/src/lib.rs) |
| 189 | market | [lib.rs:3426:31 - 3426:40](market/src/lib.rs) |
| 190 | market | [lib.rs:3493:18 - 3493:37](market/src/lib.rs) |
| 191 | market | [lib.rs:3525:25 - 3525:60](market/src/lib.rs) |
| 192 | market | [lib.rs:3527:91 - 3527:101](market/src/lib.rs) |
| 193 | market | [lib.rs:3539:27 - 3539:31](market/src/lib.rs) |
| 194 | market | [lib.rs:3539:65 - 3539:69](market/src/lib.rs) |
| 195 | market | [lib.rs:3540:13 - 3540:29](market/src/lib.rs) |
| 196 | market | [lib.rs:3541:13 - 3541:30](market/src/lib.rs) |
| 197 | market | [lib.rs:3545:13 - 3545:26](market/src/lib.rs) |
| 198 | market | [lib.rs:3546:13 - 3546:27](market/src/lib.rs) |
| 199 | market | [lib.rs:3549:9 - 3549:30](market/src/lib.rs) |
| 200 | market | [lib.rs:3561:47 - 3561:55](market/src/lib.rs) |
| 201 | market | [lib.rs:3562:25 - 3562:58](market/src/lib.rs) |
| 202 | market | [lib.rs:3601:13 - 3601:25](market/src/lib.rs) |
| 203 | market | [lib.rs:3603:13 - 3603:25](market/src/lib.rs) |
| 204 | market | [lib.rs:3616:48 - 3616:55](market/src/lib.rs) |
| 205 | market | [lib.rs:3618:44 - 3618:74](market/src/lib.rs) |
| 206 | market | [lib.rs:3623:21 - 3623:34](market/src/lib.rs) |
| 207 | market | [lib.rs:3624:21 - 3624:31](market/src/lib.rs) |
| 208 | market | [lib.rs:3632:21 - 3632:34](market/src/lib.rs) |
| 209 | market | [lib.rs:3633:21 - 3633:31](market/src/lib.rs) |
| 210 | market | [lib.rs:3619:53 - 3619:60](market/src/lib.rs) |
| 211 | market | [lib.rs:3656:9 - 3656:68](market/src/lib.rs) |
| 212 | market | [lib.rs:3696:32 - 3696:41](market/src/lib.rs) |
| 213 | market | [lib.rs:3697:33 - 3697:42](market/src/lib.rs) |
| 214 | market | [lib.rs:3701:26 - 3701:33](market/src/lib.rs) |
| 215 | market | [lib.rs:3703:32 - 3703:49](market/src/lib.rs) |
| 216 | market | [lib.rs:3704:33 - 3704:50](market/src/lib.rs) |
| 218 | market | [lib.rs:3814:62 - 3814:78](market/src/lib.rs) |
| 219 | market | [lib.rs:3828:31 - 3828:60](market/src/lib.rs) |
| 220 | market | [lib.rs:3830:13 - 3830:82](market/src/lib.rs) |
| 221 | market | [lib.rs:3831:26 - 3831:57](market/src/lib.rs) |
| 222 | market | [lib.rs:3833:32 - 3833:84](market/src/lib.rs) |
| 223 | market | [lib.rs:3834:33 - 3834:85](market/src/lib.rs) |
| 224 | market | [lib.rs:3866:9 - 3867:83](market/src/lib.rs) |
| 225 | market | [lib.rs:3885:12 - 3885:44](market/src/lib.rs) |
| 226 | market | [lib.rs:3914:45 - 3914:84](market/src/lib.rs) |
| 227 | market | [lib.rs:4014:26 - 4014:50](market/src/lib.rs) |
| 228 | market | [lib.rs:4015:30 - 4015:59](market/src/lib.rs) |
| 246 | vault_factory | [math.rs:110:26 - 110:47](vault_factory/src/math.rs) |
| 249 | vault_factory | [storage.rs:211:5 - 211:85](vault_factory/src/storage.rs) |
| 264 | vault_factory | [lib.rs:244:9 - 244:36](vault_factory/src/lib.rs) |
| 265 | vault_factory | [lib.rs:245:9 - 245:42](vault_factory/src/lib.rs) |
| 266 | vault_factory | [lib.rs:247:13 - 247:41](vault_factory/src/lib.rs) |
| 267 | vault_factory | [lib.rs:261:20 - 261:34](vault_factory/src/lib.rs) |
| 268 | vault_factory | [lib.rs:740:9 - 740:32](vault_factory/src/lib.rs) |
| 269 | vault_factory | [lib.rs:746:43 - 746:53](vault_factory/src/lib.rs) |
| 270 | vault_factory | [lib.rs:891:17 - 891:47](vault_factory/src/lib.rs) |
| 280 | noether_router | [lib.rs:492:15 - 492:43](noether_router/src/lib.rs) |
| 289 | noether_router | [lib.rs:807:23 - 807:70](noether_router/src/lib.rs) |
| 290 | noether_router | [lib.rs:842:25 - 842:41](noether_router/src/lib.rs) |
| 291 | noether_router | [lib.rs:845:17 - 845:23](noether_router/src/lib.rs) |
| 292 | noether_router | [lib.rs:848:25 - 848:41](noether_router/src/lib.rs) |
| 293 | noether_router | [lib.rs:858:17 - 858:23](noether_router/src/lib.rs) |
| 294 | noether_router | [lib.rs:867:29 - 867:54](noether_router/src/lib.rs) |
| 318 | vault | [noe.rs:30:36 - 30:56](vault/src/noe.rs) |
| 319 | vault | [noe.rs:58:36 - 58:56](vault/src/noe.rs) |
| 320 | vault | [lib.rs:168:19 - 168:75](vault/src/lib.rs) |
| 321 | vault | [lib.rs:169:26 - 169:43](vault/src/lib.rs) |
| 322 | vault | [lib.rs:197:30 - 197:63](vault/src/lib.rs) |
| 323 | vault | [lib.rs:198:41 - 198:62](vault/src/lib.rs) |
| 324 | vault | [lib.rs:202:30 - 202:56](vault/src/lib.rs) |
| 325 | vault | [lib.rs:270:19 - 270:74](vault/src/lib.rs) |
| 326 | vault | [lib.rs:271:24 - 271:40](vault/src/lib.rs) |
| 327 | vault | [lib.rs:288:12 - 288:103](vault/src/lib.rs) |
| 328 | vault | [lib.rs:296:30 - 296:63](vault/src/lib.rs) |
| 329 | vault | [lib.rs:297:30 - 297:56](vault/src/lib.rs) |
| 330 | vault | [lib.rs:366:29 - 366:48](vault/src/lib.rs) |
| 331 | vault | [lib.rs:372:37 - 372:89](vault/src/lib.rs) |
| 332 | vault | [lib.rs:385:46 - 385:66](vault/src/lib.rs) |
| 333 | vault | [lib.rs:387:31 - 387:49](vault/src/lib.rs) |
| 334 | vault | [lib.rs:389:42 - 389:62](vault/src/lib.rs) |
| 335 | vault | [lib.rs:393:29 - 393:39](vault/src/lib.rs) |
| 336 | vault | [lib.rs:394:60 - 394:110](vault/src/lib.rs) |
| 337 | vault | [lib.rs:395:37 - 395:64](vault/src/lib.rs) |
| 338 | vault | [lib.rs:396:50 - 396:90](vault/src/lib.rs) |
| 339 | vault | [lib.rs:443:30 - 443:59](vault/src/lib.rs) |
| 340 | vault | [lib.rs:471:25 - 471:67](vault/src/lib.rs) |
| 341 | vault | [lib.rs:477:34 - 477:47](vault/src/lib.rs) |
| 342 | vault | [lib.rs:494:22 - 495:37](vault/src/lib.rs) |
| 343 | vault | [lib.rs:497:41 - 497:56](vault/src/lib.rs) |
| 344 | vault | [lib.rs:500:38 - 500:56](vault/src/lib.rs) |
| 345 | vault | [lib.rs:502:24 - 502:42](vault/src/lib.rs) |
| 346 | vault | [lib.rs:535:21 - 535:80](vault/src/lib.rs) |
| 347 | vault | [lib.rs:540:63 - 540:81](vault/src/lib.rs) |
| 348 | vault | [lib.rs:581:27 - 581:74](vault/src/lib.rs) |
| 349 | vault | [lib.rs:582:12 - 582:43](vault/src/lib.rs) |
| 350 | vault | [lib.rs:588:27 - 588:89](vault/src/lib.rs) |
| 351 | vault | [lib.rs:598:24 - 598:85](vault/src/lib.rs) |
| 352 | vault | [lib.rs:599:49 - 599:64](vault/src/lib.rs) |
| 353 | vault | [lib.rs:600:51 - 600:67](vault/src/lib.rs) |
| 354 | vault | [lib.rs:611:12 - 611:84](vault/src/lib.rs) |
| 355 | vault | [lib.rs:615:35 - 615:52](vault/src/lib.rs) |
| 356 | vault | [lib.rs:842:34 - 842:82](vault/src/lib.rs) |
| 357 | vault | [lib.rs:858:34 - 858:82](vault/src/lib.rs) |
| 358 | vault | [lib.rs:869:26 - 869:47](vault/src/lib.rs) |
| 359 | vault | [lib.rs:874:30 - 874:67](vault/src/lib.rs) |
| 360 | vault | [lib.rs:881:45 - 881:65](vault/src/lib.rs) |
| 361 | vault | [lib.rs:907:12 - 907:34](vault/src/lib.rs) |
| 362 | vault | [lib.rs:908:19 - 908:35](vault/src/lib.rs) |
| 363 | vault | [lib.rs:922:50 - 922:72](vault/src/lib.rs) |
| 364 | vault | [lib.rs:924:27 - 924:45](vault/src/lib.rs) |
| 365 | vault | [lib.rs:926:38 - 926:58](vault/src/lib.rs) |
| 366 | vault | [lib.rs:929:52 - 929:62](vault/src/lib.rs) |
| 367 | vault | [lib.rs:930:29 - 930:54](vault/src/lib.rs) |
| 368 | vault | [lib.rs:931:49 - 931:94](vault/src/lib.rs) |
| 369 | vault | [lib.rs:935:35 - 935:45](vault/src/lib.rs) |
| 370 | vault | [lib.rs:1000:38 - 1000:54](vault/src/lib.rs) |
| 371 | vault | [lib.rs:1001:34 - 1001:64](vault/src/lib.rs) |
| 372 | vault | [lib.rs:1004:19 - 1004:68](vault/src/lib.rs) |
| 373 | vault | [lib.rs:1007:19 - 1007:83](vault/src/lib.rs) |
| 374 | vault | [lib.rs:1032:33 - 1033:51](vault/src/lib.rs) |
| 375 | vault | [lib.rs:1041:38 - 1041:50](vault/src/lib.rs) |
| 376 | vault | [lib.rs:1114:23 - 1114:71](vault/src/lib.rs) |
| 377 | vault | [lib.rs:1309:19 - 1309:59](vault/src/lib.rs) |
| 385 | noeracle_shim | [lib.rs:356:21 - 356:45](noeracle_shim/src/lib.rs) |
| 386 | noeracle_shim | [lib.rs:356:32 - 356:44](noeracle_shim/src/lib.rs) |
| 387 | noeracle_shim | [lib.rs:358:37 - 358:61](noeracle_shim/src/lib.rs) |
| 388 | noeracle_shim | [lib.rs:358:48 - 358:60](noeracle_shim/src/lib.rs) |
| 396 | risk | [risk.rs:139:19 - 139:81](risk/src/risk.rs) |
| 397 | risk | [risk.rs:141:5 - 141:49](risk/src/risk.rs) |
| 398 | risk | [risk.rs:146:17 - 146:48](risk/src/risk.rs) |
| 399 | risk | [risk.rs:149:22 - 149:28](risk/src/risk.rs) |
| 400 | risk | [risk.rs:150:9 - 150:15](risk/src/risk.rs) |
| 401 | risk | [risk.rs:172:9 - 172:82](risk/src/risk.rs) |
| 402 | risk | [risk.rs:174:20 - 174:50](risk/src/risk.rs) |
| 403 | risk | [risk.rs:178:9 - 178:92](risk/src/risk.rs) |
| 404 | risk | [risk.rs:191:23 - 191:85](risk/src/risk.rs) |
| 405 | risk | [risk.rs:209:23 - 209:64](risk/src/risk.rs) |
| 406 | risk | [risk.rs:210:5 - 210:37](risk/src/risk.rs) |


### Divide Before Multiply

**Impact:** Medium

**Issue:** Division before multiplication might result in a loss of precision

**Description:** Division before multiplication might result in a loss of precision

[**Learn More**](https://coinfabrik.github.io/scout-audit/docs/detectors/rust/divide-before-multiply)

#### Findings

| ID  | Package | File Location |
| --- | ------- | ------------- |
| 171 | market | [lib.rs:2301:13 - 2301:60](market/src/lib.rs) |
| 245 | vault_factory | [math.rs:117:10 - 117:47](vault_factory/src/math.rs) |


