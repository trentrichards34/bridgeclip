# Delivery: what to hand the user with the video

1. **The file**: `videos/<slug>/out/<name>.mp4` (1080×1920, 30 fps, H.264 + AAC, ~8-12 Mbps). Upload it as-is; Instagram's "Upload at highest quality" setting should be on (Settings → Data usage and media quality).
2. **Caption** (write it in `out/caption.txt` too):
   - Line 1: a second hook that adds context, not a repeat of the video's first line.
   - Line 2-3: the one-line takeaway + "Comment KEYWORD and I'll DM you the link."
   - 3-5 specific hashtags (topic + niche), no #ad unless it's a paid partnership (then use the platform's paid-partnership label too).
3. **The DM automation** the CTA promises: "Comment KEYWORD" only works if an auto-DM tool sends the link (ManyChat, ReplyRush, or Instagram's built-in automations in Professional accounts). Remind the user to set the keyword exactly as in the video, before posting.
4. **Cover frame**: suggest the timestamp of the clearest, most intriguing frame (usually the hook visual at ~0.5-1 s) for the reel cover.
5. Offer one round of changes. Common ones: faster/slower voice (`tts.py --speed`, then re-cue), different voice, swap a scene, shorter (cut a beat from the script + re-voice), different keyword.

Never post or upload anything yourself.
