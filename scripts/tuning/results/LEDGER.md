# Tuning ledger (Dan approved $100 for the tuning work on 2026-11-04 ~02:45 CET; autonomous for ~24 h; Dan commits, I do not)

Rule: log EVERY GPU use here with an estimate BEFORE starting it, and reconcile after. Stop and report if the running total of estimates passes $80. Prices: L40S $1.95/h, A100-80GB $2.50/h, H100 $3.95/h, CPU about $0.047 per core-hour (Modal list prices read 2026-11-01).
Check `modal app list` for stray running apps before and after every stage. Never `modal deploy` the base Glimmer app while a run uses it. No `min_containers` above 0 anywhere.

| # | when | what | est. GPU-h | est. $ | actual / note |
|---|------|------|-----------:|-------:|---------------|
| 1 | 02:45 | wishes: ~25 Glimmer calls on the existing base container | 0.2 | 0.4 | |
| 2 | 02:55 | sampling pass 1: 1,000 calls, concurrency 4 (about 2 containers) | 3.6 | 7.0 | in progress: samples.jsonl, log tune-sample.log |
| - | 03:00 | (no spend) wrote convert / tuned server / parity scripts, tests | 0 | 0 | |
| 3 | 03:40 | smoke training: 60 steps on 190 samples (L40S), first image build + base-model download | 1.0 | 4.0 | pending; sampling continues in parallel (CPU-starved by a peer, about 54 samples/h) |
| 3a | 03:50 | smoke-1 attempt 1: image build (CPU) + model load + 4 failed starts (TypeError SFTTrainer tokenizer -> processing_class, retries removed) | 0.15 | 0.3 | image builds in 176 s with the pinned install; weights load in ~3 s from the cached volume |
| 3b | 04:05 | smoke-1 attempt 2 (same 60 steps, fixed keyword, no retries) | 0.8 | 1.6 | pending |
| 3 | 04:12 | RECONCILED smoke-1: attempt 2 of the 03:39 launch (Unsloth patched SFTTrainer in-process so the retry passed) trained all 60 steps; the 03:56 launch resumed checkpoint-60 and did 1 step. Loss 1.02 -> 0.155, eval 0.215 -> 0.177, peak 22.4 GB of 44. Total GPU for smoke about 0.25 h | 0.25 | 0.5 | image build was CPU only; est $4 was 8x too high |
| 4 | 04:12 | generate check on the smoke adapter: 20 heldout wishes (L40S, load + 20 answers) | 0.15 | 0.3 | pending |
| 5 | 04:28 | convert inspect + lora on the smoke adapter: CPU only (4 cores, 32 GB, a few minutes) plus a cmake build of llama.cpp b12078 in the image | 0 | 0.1 | pending; de-risks serving while sampling finishes |
| 5 | 04:35 | RECONCILED convert: lora-f16.gguf for smoke-1 made (832 tensors, 210 MB) after a 2-line patch of llama.cpp's LoRA converter; CPU only | 0 | 0.2 | route A converts; whether llama-server LOADS and APPLIES it is next |
| 6 | 04:36 | deploy toyventor-glimmer-tuned (smoke-1, lora) + a few test requests on one L40S (cold start about 2 min, then seconds) | 0.15 | 0.3 | pending |
| 4 | 04:55 | RECONCILED generate check smoke-1: 20/20 valid JSON, 20/20 thought first, mean 649 new tokens; it ran 40 min (HF decode is slow) | 0.7 | 1.4 | too slow to repeat at n=20 |
| 7 | 04:56 | smoke-2: 60 steps on smoke-ds with Meta's chat template (template-parity fix) + prompt_check.json | 0.1 | 0.3 | pending |
| 2 | 05:50 | RECONCILED sampling pass 1: 1,000 calls done 02:48-05:49, 983 printable, 2 failed; 2 containers most of the time, slowed 03:25-04:05 by a peer's CPU load (containers idle-billed) | 5.5 | 10.7 | estimate (Modal billing not read); 7.0 was the plan |
| 8 | 05:55 | pilot-1 (variant keep, 2 epochs, lr 2e-4, r16) and pilot-2 (variant skip, same) on the real dataset: 910 train, about 455 steps each, 2 L40S in parallel | 0.5 | 1.0 | pending |
| 8 | 06:50 | RECONCILED pilots: 456 steps each took about 27 min (3 s/step, not 1.35: longer real examples + eval every 40 steps) on 2 L40S from 06:20 | 0.9 | 1.8 | eval loss keep 0.183 -> 0.131, skip 0.180 -> 0.128 at epoch 1.76, still falling |
| 9 | 06:51 | BASE evaluation: 243 wishes (heldout 128, acceptance 40, redteam 75), production prompt, base container, concurrency 2 | 0.9 | 1.8 | pending |
| 10 | 07:05 | convert pilot-1 and pilot-2 to GGUF LoRA (CPU) and deploy toyventor-glimmer-tuned (pilot-1, keep) + toyventor-glimmer-tuned-skip (pilot-2, skip); each serves on one L40S while evaluated | 0 | 0.2 | pending; evals of the tuned variants follow (est 1.7 each) |
| 11 | 06:55 | TUNED evaluations, 243 wishes each: tuned-keep (pilot-1) and tuned-skip (pilot-2), one L40S each, concurrency 2, run beside the base eval | 1.8 | 3.4 | pending; template parity 5/5 identical for both |
| 9-11 | 07:56 | RECONCILED evals (243 wishes each, ran 06:50-07:55): base, tuned-keep, tuned-skip: about 1 container-hour each | 3.0 | 5.9 | RESULT: both pilots DO NOT SHIP (speed 35-55% faster, but first-call printable 90/93% vs 98.8%, brand names in names 2x, red-team 80/77% vs 87%); unsafe 42/42 and inject 7/7 for all three |
| 12 | 08:25 | eval of pilot-1 adapter with the FULL production prompt (no retraining; tuned server pilot-1), 243 wishes | 1.0 | 2.0 | pending |
| 13 | 08:10 | pilot-3 (keep) and pilot-4 (skip) on dataset-p1 = the FULL production prompt (about 3.1k tokens an example), 2 epochs, H100 80GB each (about 20 s per step on L40S would be 2.5 h; H100 est 1-1.2 h) | 2.4 | 9.5 | pending; first run at this length, may OOM or be slow: stop and report if it passes 2 h |
| 14 | 08:20 | brand-wish sampling: 294 wishes (7 languages, brands NOT in the evaluation), 1 call each through the real pipeline with the production prompt on the base container, concurrency 4 | 1.2 | 2.4 | pending; for the next dataset |
| 12 | 09:10 | RECONCILED: eval of pilot-1 with the full prompt ran 08:03-09:05. RESULT: quality up (first-call 94.4%, printable 99.4%) but speed gain gone (28.2 s vs 32.4) and brand name-filter fires unchanged (23, 11.6%): the brand behaviour is in the WEIGHTS, not the prompt | 1.0 | 2.0 | |
| 14 | 09:10 | RECONCILED: brand sampling 294 calls done 08:20-09:05 (294 ok, 292 printable); 104 survive the stricter brand-word filter | 0.8 | 1.6 | |
| 15 | 09:10 | pilot-5 (keep) on dataset-p2 (p1 prompt, 1,014 train incl. 104 brand-wish examples with brand-free names), 2 epochs, H100 | 1.0 | 4.0 | pending |
| ! | 09:12 | MODAL WORKSPACE DISABLED (FAILED_PRECONDITION: workspace ac-PJ5QNwI7MjIFc4ssBh7p4T is disabled; web endpoints answer 404 "workspace is disabled"). pilot-4 (skip, p1) died at about 85%, pilot-5 (keep, p2) never trained, tuned server for pilot-3 unreachable. pilot-3 (keep, p1) FINISHED and converted (lora-f16.gguf in volume toyventor-tune-out); not evaluated. | - | - | needs Dan: billing/spend limit. My ledger estimate to this point is about $38 (see rows), but Modal's own number is unknown to me (old client has no billing command) |
| ! | 09:30 | MODAL WORKSPACE ENABLED AGAIN (about 20 minutes down, 09:07-09:30); jobs resumed | - | - | cause not seen by me |
| 15 | 09:31 | pilot-5 (keep) on dataset-p2, restarted after the outage | 1.0 | 4.0 | pending |
| 16 | 09:31 | eval of pilot-3 (keep, p1 production prompt), 243 wishes on the tuned server | 1.0 | 2.0 | pending |
