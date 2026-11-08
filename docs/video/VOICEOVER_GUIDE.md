# RecallReady voiceover timing

Silent screen recording verified: **170 seconds (2:50), 1920×1080, 30 fps**. No audio or voiceover was generated. Local output: `recordings/submission/RecallReady-submission-screen-recording.mp4`.

Use the eight paragraphs in `NARRATION.txt`, in order. Generating one paragraph per scene gives you control over the pauses and avoids drifting out of sync. The screen footage has readable holds; leave space around model numbers, approval, and the repeated attempt.

| Scene | Start | End | Length | Narration paragraph |
| --- | --- | --- | --- | --- |
| Three orders | 0:00 | 0:18 | 18s | 1 |
| Intended user | 0:18 | 0:32 | 14s | 2 |
| Source and AI review | 0:32 | 0:59 | 27s | 3 |
| Three outcomes | 0:59 | 1:24 | 25s | 4 |
| Approved sandbox refund | 1:24 | 1:58 | 34s | 5 |
| Repeat protection | 1:58 | 2:19 | 21s | 6 |
| Implementation | 2:19 | 2:35 | 16s | 7 |
| Closing | 2:35 | 2:50 | 15s | 8 |

Use clear, conversational English. Pronounce PB0003 with all three zeros, and PB003 with two. Listen to the completed audio before assembly. Actual speech duration must be measured; if a paragraph exceeds its scene, adjust its delivery or edit the holds while preserving the sub-three-minute final runtime.

## Footage disclosures

The product footage uses synthetic orders, actual CPSC/Gemini source extraction, and real PayPal sandbox transactions. Original source and refund approvals are retained. The layout was corrected afterward; blocked-case and completed-result/repeat pickups use the corrected layout with the same original transaction. Review and processing waits are shortened, and crops/final-frame holds are logged in the local edit manifest. No new purchase or refund approval was performed for pickups.

The silent recording still needs the owner’s voiceover and final audio synchronization. A public video upload and Devpost submission have not been performed.

## Locked picture and tagged voiceover

The owner approved locking this silent edit on November 8, 2026. `PICTURE_LOCK.json` records the exact MP4 SHA-256 and the eight scene durations. The lock covers the screen edit; final audio synchronization and review remain.

Use `NARRATION_01_TAGGED.txt` through `NARRATION_08_TAGGED.txt` separately, or consult `NARRATION_TAGGED.txt` for the complete script. The headings and timestamps in this guide should not be pasted into the speech prompt. Keep the same voice and model across all eight clips. The tags give subtle delivery direction, with brief pauses in the opening and repeat proof. Their exact timing depends on the chosen voice; verify that no tags are spoken aloud.

ElevenLabs documents audio-tag support in Eleven v4 and v3 and recommends v4: https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4 . Use v4 when available, or v3. Generate a short sample, listen for every zero in PB0003/PB003, and measure each clip against the scene lengths above. If a clip is long, trim excess silence or adjust the narration delivery before final assembly.
