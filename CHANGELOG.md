## [1.13.1](https://github.com/quran-th/quran-api/compare/v1.13.0...v1.13.1) (2026-11-08)


### Bug Fixes

* cache unmeasured recitation timings for 1 hour ([#7](https://github.com/quran-th/quran-api/issues/7)) ([e93cd8d](https://github.com/quran-th/quran-api/commit/e93cd8d70390b85e48e37a85ff1d835c34827f59))
* cache unmeasured recitation timings for 1 hour, not 7 days ([f2c6897](https://github.com/quran-th/quran-api/commit/f2c68975870e7b1a822f124b2a92a2edf4e38bb1))

# [1.13.0](https://github.com/quran-th/quran-api/compare/v1.12.3...v1.13.0) (2026-11-08)


### Features

* measured recitation pauses in timings ([3a8e26d](https://github.com/quran-th/quran-api/commit/3a8e26d79e85a5a2d6d57d89811d3fb5febeb0e4))
* measured recitation pauses in timings ([#6](https://github.com/quran-th/quran-api/issues/6)) ([d4aafde](https://github.com/quran-th/quran-api/commit/d4aafde1c99f1275dc8018a45a2449b89ac566b8))

## [1.12.3](https://github.com/quran-th/quran-api/compare/v1.12.2...v1.12.3) (2026-11-08)


### Bug Fixes

* Mukhtasar 101:1-3 hearts terrified, not excited; lock ([0c59ff1](https://github.com/quran-th/quran-api/commit/0c59ff1d17c2025e769c2faa47c7cf2e9e3113d6))
* Mukhtasar 101:1-3 wording (ตื่นตระหนก) ([#5](https://github.com/quran-th/quran-api/issues/5)) ([686c462](https://github.com/quran-th/quran-api/commit/686c462ff866186fe1ff095a55da49c4b8ff1d4a))

## [1.12.2](https://github.com/quran-th/quran-api/compare/v1.12.1...v1.12.2) (2026-11-08)


### Bug Fixes

* translate both divine names in Mukhtasar 1:3 ([4275f21](https://github.com/quran-th/quran-api/commit/4275f2192b7d02edd550c03ea1edd03e80d4a256))
* translate both divine names in Mukhtasar 1:3 ([#4](https://github.com/quran-th/quran-api/issues/4)) ([286e0c7](https://github.com/quran-th/quran-api/commit/286e0c71ec4ea81717c6776fed6f248f2208987f))

## [1.12.1](https://github.com/quran-th/quran-api/compare/v1.12.0...v1.12.1) (2026-11-08)


### Bug Fixes

* lock hand-corrected translations against source sync; correct Mukhtasar 1:3 ([2376cdc](https://github.com/quran-th/quran-api/commit/2376cdcff2047697f5aa6bd8e2efc945716a550d))
* lock hand-corrected translations; correct Mukhtasar 1:3 ([#2](https://github.com/quran-th/quran-api/issues/2)) ([624b691](https://github.com/quran-th/quran-api/commit/624b6910a936fe9af5c35a806739bb8ca9b3063f))

# [1.12.0](https://github.com/quran-th/quran-api/compare/v1.11.0...v1.12.0) (2026-11-08)


### Features

* translation audio endpoint and TTS pipeline ([f3e8a89](https://github.com/quran-th/quran-api/commit/f3e8a89e92ce366480602dfed80389b4ed9bdecb))
* translation audio endpoint and TTS pipeline ([#3](https://github.com/quran-th/quran-api/issues/3)) ([6a16054](https://github.com/quran-th/quran-api/commit/6a1605417e3c8fb627e0525788cf17706954e440))

# [1.11.0](https://github.com/quran-th/quran-api/compare/v1.10.0...v1.11.0) (2026-11-01)


### Bug Fixes

* shorten /reciters cache to 5 minutes ([2fe19b9](https://github.com/quran-th/quran-api/commit/2fe19b93030ee8597b53416b60a32c69c6b0d567))


### Features

* add mp3quran reciters with ayah-level timings ([8910c95](https://github.com/quran-th/quran-api/commit/8910c959bc4b782e1c7f43078bc6f4fd19084126))

# [1.10.0](https://github.com/quran-th/quran-api/compare/v1.9.0...v1.10.0) (2026-10-30)


### Features

* reciters list and word-timing recitation endpoints ([1a8d23f](https://github.com/quran-th/quran-api/commit/1a8d23f6afccb7b1c31393834824c7975a17d231))

# [1.9.0](https://github.com/quran-th/quran-api/compare/v1.8.2...v1.9.0) (2026-04-16)


### Bug Fixes

* type errors for new sync api ([f215f43](https://github.com/quran-th/quran-api/commit/f215f43db8ade3013c8e95ffea27088e17e3a20f))


### Features

* add admin sync endpoints for gap detection and verse insertion ([7ba4ce7](https://github.com/quran-th/quran-api/commit/7ba4ce7916e0cd42070211a6a5f06a8a7e2fa1a2))

## [1.8.2](https://github.com/quran-th/quran-api/compare/v1.8.1...v1.8.2) (2026-04-15)


### Bug Fixes

* unblock response with `waitUntil` instead of await ([a95a9ed](https://github.com/quran-th/quran-api/commit/a95a9ed29dfd0f9fa125bc9827c34877fb33c1dd))

## [1.8.1](https://github.com/quran-th/quran-api/compare/v1.8.0...v1.8.1) (2026-04-15)


### Bug Fixes

* strip out `<br/>` from mukhtasar text ([44cb49b](https://github.com/quran-th/quran-api/commit/44cb49bf1fadddf2bfe10ba2279241906769626a))

# [1.8.0](https://github.com/quran-th/quran-api/compare/v1.7.0...v1.8.0) (2026-04-14)


### Features

* support admin management for external source ([7eb1f1b](https://github.com/quran-th/quran-api/commit/7eb1f1b08552766d5f304636affb9065149af20b))

# [1.7.0](https://github.com/quran-th/quran-api/compare/v1.6.0...v1.7.0) (2026-04-14)


### Features

* add external source with auto revalidating translation ([6d7e679](https://github.com/quran-th/quran-api/commit/6d7e67988d69a59f5a0c3dd0729d17f046e2cddd))
* add external source with auto revalidating translation ([5fda697](https://github.com/quran-th/quran-api/commit/5fda697d7d8f53e015a292e0e9703e9d16d191d8))

# [1.6.0](https://github.com/quran-th/quran-api/compare/v1.5.0...v1.6.0) (2026-04-01)


### Bug Fixes

* type errors ([799be89](https://github.com/quran-th/quran-api/commit/799be891deed23e6bd948d2891fc33adedd21145))


### Features

* add juz metadata api and issue to contribute api ([878e4d5](https://github.com/quran-th/quran-api/commit/878e4d518cd56248f54f82dad0e5f2a1db599d7a))

# [1.5.0](https://github.com/quran-th/quran-api/compare/v1.4.1...v1.5.0) (2026-03-29)


### Features

* add `surah_meaning_thai` prop to surahs ([9c29322](https://github.com/quran-th/quran-api/commit/9c2932220759fc0da127f608192545f106faf667))

## [1.4.1](https://github.com/quran-th/quran-api/compare/v1.4.0...v1.4.1) (2026-03-29)


### Bug Fixes

* type and lint errors ([18fba59](https://github.com/quran-th/quran-api/commit/18fba5924bf6a739b96ed6a89fa24bf3ea5ab681))

# [1.4.0](https://github.com/quran-th/quran-api/compare/v1.3.1...v1.4.0) (2026-03-29)


### Features

* add public report endpoints with Turnstile anti-spam ([8c9bda7](https://github.com/quran-th/quran-api/commit/8c9bda7354d20ddcbb682bf2d79ca7bc43931d58))

## [1.3.1](https://github.com/quran-th/quran-api/compare/v1.3.0...v1.3.1) (2026-03-09)


### Bug Fixes

* resolve all ESLint no-explicit-any and TypeScript errors ([e25cf79](https://github.com/quran-th/quran-api/commit/e25cf79500f8ab8ad7cb5616bbffd626a296ad42))

# [1.3.0](https://github.com/quran-th/quran-api/compare/v1.2.0...v1.3.0) (2026-03-09)

### Bug Fixes

- utilize d1 id and use route ([6e2a5d0](https://github.com/quran-th/quran-api/commit/6e2a5d052a49a03a032d1c507aaee333c20fa2df))

### Features

- add get verses by key endpoint ([f54f9fe](https://github.com/quran-th/quran-api/commit/f54f9feaa8de2d80e7b745e302e1d0889cc0fbfa))
- add multi-language support for word by word translations ([a49f877](https://github.com/quran-th/quran-api/commit/a49f877dcc54894cef0064b78ac41b8215e9dedf))

# [1.2.0](https://github.com/quran-th/quran-api/compare/v1.1.1...v1.2.0) (2026-03-05)

### Features

- add ESLint config and migrate asset fetching to R2 binding ([c5bc68f](https://github.com/quran-th/quran-api/commit/c5bc68f2cea4b7969002051cb005ecc452ae591b))

## [1.1.1](https://github.com/quran-th/quran-api/compare/v1.1.0...v1.1.1) (2026-03-04)

### Bug Fixes

- fix type error and access bucket through binding instead of slower http ([61e285a](https://github.com/quran-th/quran-api/commit/61e285a311fd59ffe5f1b1b417b39e6a81027778))

# [1.1.0](https://github.com/quran-th/quran-api/compare/v1.0.0...v1.1.0) (2026-03-04)

### Features

- utilize public assets bucket for quran word data ([872f26d](https://github.com/quran-th/quran-api/commit/872f26d654d02e2e0de4f621ace3469ff24683e9))

# 1.0.0 (2026-03-04)

### Bug Fixes

- resolve empty ayah result ([75060c5](https://github.com/quran-th/quran-api/commit/75060c50fb40efd8cc3af15c33e0bd9a660ec5e8))

### Features

- Add pagination, release workflow, and API improvements ([50fe7f0](https://github.com/quran-th/quran-api/commit/50fe7f0bc975cb861d21fc7e0267da6e151226ae))
- block deactivated users on write operations ([533c87b](https://github.com/quran-th/quran-api/commit/533c87b30efebdc65a032db6257e4e6a308edec1))
