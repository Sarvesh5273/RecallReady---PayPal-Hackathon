"""Edit actual browser footage for the 2:50 manual voiceover timeline.

Product pixels come from browser recordings. Crops, wait cuts, labels and
final-frame holds are logged. Human approvals retain original footage.
"""
from pathlib import Path
import json, subprocess
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / 'recordings/submission'
original = json.loads((out / 'capture-manifest.json').read_text())
pickups = json.loads((out / 'pickups/capture-manifest.json').read_text())
if len(original['shots']) != 8 or len(pickups['shots']) != 4:
    raise SystemExit('Original scenes and aligned-layout pickups required.')
gate = next(g for g in original['gates'] if g['type'] == 'VERIFIED_SANDBOX_REFUND')
if gate['status'] != 'COMPLETED' or pickups['originalAttemptId'] != gate['attemptId']:
    raise SystemExit('Matching genuine sandbox proof required.')
shots = {s['id']: s for s in original['shots']}
new = {s['id']: s for s in pickups['shots']}

def segment(shot, start, end, duration, crop=None):
    return dict(source=shot['rawVideo'], start=start, end=end, duration=duration, crop=crop)

scenes = [
 ('01','Three orders. One recall.','Same brand. Similar titles. Different evidence.',[
  segment(shots['01'],.8,16.8,18)]),
 ('02','For small sellers & support teams','Source → order → merchant decision',[
  segment(shots['02'],.8,13.4,14)]),
 ('03','AI extracts. The operator reviews.','Actual Gemini candidate · review wait shortened',[
  segment(shots['03'],.8,5.3,5),
  segment(shots['03'],5.5,10.5,8,[1080,800,770,280]),
  segment(shots['03'],40,44,5,[300,590,760,490]),
  segment(shots['03'],99,107.8,9)]),
 ('04','Three evidence outcomes','Confirmed match · different model · missing model',[
  # The exact case is retained before its refund; blocked cases use the fix.
  segment(shots['04'],.8,7.5,8,[645,140,850,940]),
  segment(new['04'],8.2,15,8.5), segment(new['04'],15.8,22.5,8.5)]),
 ('05','A deliberate $49.00 sandbox refund','Original operator approval retained · review/processing waits shortened',[
  segment(shots['05'],1.8,9,8),
  segment(shots['05'],10.8,15.8,7,[645,605,850,475]),
  segment(shots['05'],136.7,139,3,[735,395,1160,685]),
  segment(shots['05'],140,147.5,8), segment(new['05-result'],.8,8,8)]),
 ('06','Repeat request. Same attempt.','One capture · one execution record · one verified refund',[
  segment(new['06'],.8,19.6,21)]),
 ('07','Evidence you can inspect','AG Grid · PostgreSQL · public MIT repository',[
  segment(new['07'],.8,15,16)]),
 ('08','The right order. The right evidence. Your decision.','Synthetic orders · real source extraction · PayPal sandbox',[
  segment(shots['08'],.8,14.3,15)]),
]
font_file='/System/Library/Fonts/Helvetica.ttc'
title_font=ImageFont.truetype(font_file,30)
sub_font=ImageFont.truetype(font_file,23)
tag_font=ImageFont.truetype(font_file,20)
clips,edits=[],[]
timeline=0
for sid,title,subtitle,segments in scenes:
    label=out/f'{sid}-editorial-label.png'
    overlay=Image.new('RGBA',(1920,1080),(0,0,0,0));draw=ImageDraw.Draw(overlay)
    draw.rectangle((0,986,1920,1080),fill='#123d34')
    draw.text((40,997),title,font=title_font,fill='white')
    draw.text((40,1040),subtitle,font=sub_font,fill='#d9e8dc')
    draw.text((1675,1002),'PAYPAL SANDBOX',font=tag_font,fill='#d6f1be')
    overlay.save(label)
    parts=[]
    for i,item in enumerate(segments):
        source=Path(item['source'])
        if not source.exists(): raise SystemExit('Missing raw footage: '+source.name)
        raw_duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(source)],text=True).strip())
        if item['end']>raw_duration: raise SystemExit(f'Scene {sid} range exceeds source duration {raw_duration}.')
        if item['duration']<item['end']-item['start']-.01: raise SystemExit('Footage must not be sped up.')
        filters=[f"trim=start={item['start']}:end={item['end']}",'setpts=PTS-STARTPTS']
        if item['crop']:
            x,y,w,h=item['crop'];filters.append(f'crop={w}:{h}:{x}:{y}')
        filters+=['scale=1920:972:force_original_aspect_ratio=decrease',
          'pad=1920:1080:(ow-iw)/2:(972-ih)/2:color=0xf5f7f0','setsar=1','fps=30',
          f"tpad=stop_mode=clone:stop_duration={item['duration']}",f"trim=duration={item['duration']}",'format=yuv420p']
        part=out/f'{sid}-part-{i}.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-loop','1','-i',str(label),
          '-filter_complex','[0:v]'+','.join(filters)+'[screen];[screen][1:v]overlay=0:0:shortest=1[v]',
          '-map','[v]','-an','-c:v','libx264','-preset','fast','-crf','18','-t',str(item['duration']),'-movflags','+faststart',str(part)],check=True)
        parts.append(part)
    playlist=out/f'{sid}-concat.txt';playlist.write_text(''.join(f"file '{p.name}'\n" for p in parts))
    clip=out/f'{sid}-screen.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(playlist),'-c','copy','-movflags','+faststart',str(clip)],check=True)
    duration=sum(s['duration'] for s in segments)
    edits.append(dict(scene=sid,title=title,startSeconds=timeline,durationSeconds=duration,editorialLabel=subtitle,segments=segments,speedFactor=1))
    timeline+=duration;clips.append(clip);print(f'ASSEMBLED {sid}: {duration}s',flush=True)
if timeline!=170: raise SystemExit('Voiceover timeline must remain 170 seconds.')
playlist=out/'concat.txt';playlist.write_text(''.join(f"file '{p.name}'\n" for p in clips))
final=out/'RecallReady-submission-screen-recording.mp4'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(playlist),'-c','copy','-movflags','+faststart',str(final)],check=True)
(out/'edit-manifest.json').write_text(json.dumps(dict(totalDurationSeconds=timeline,voiceoverIncluded=False,syntheticUIIncluded=False,workspaceId=original['workspaceId'],verifiedRefundId=gate['refundId'],edits=edits,
 disclosure='All product screens are actual app recordings. Source and refund approvals retain original footage. Subsequent result, blocked-case and repeat-check shots use the corrected layout. Review and processing waits shortened; crops and final-frame holds logged. No approval or new refund reenacted.'),indent=2)+'\n')
print('VIDEO_READY: '+str(final),flush=True)
