// Fixed local guidance only. This never participates in tracking or capture.
const guidance = {
  slow: ['映像の処理が追いつきません。', 'ほかのアプリやタブを閉じて、もう一度試してください。繰り返す場合は別の端末でも確認できます。'],
  no_person: ['顔と両手を、明るい場所へ。', 'レンズが隠れていないか確認し、顔・肩・ひじ・両手首を映してから、もう一度試してください。'],
  occluded: ['両手首を、机より上に。', '両手を胸の前の楽な高さへ。手首が机や袖に隠れていないか、プレビューで確認してください。'],
  out_of_frame: ['両手首を、画面の内側へ。', '顔・肩・ひじ・両手首が一緒に映るよう、カメラの向きを調整してください。'],
  multiple_people: ['一人だけで映してください。', 'ほかの人が画面に入らない向きにカメラを置き、もう一度試してください。'],
  stable: ['手首を、少し止めてみよう。', '両手を胸の前の楽な高さに置き、もう一度試してください。点がつくまではゆっくり待ちます。'],
  no_response: ['手の確認が終わりませんでした。', '映像が動いているか確認して、もう一度試してください。繰り返す場合はページを読み込み直せます。']
};
export function poseRecovery({state, reason, searchReason}) {
  if (!['paused','error'].includes(state)) return null;
  const timeout = reason === 'person_timeout';
  const key = timeout ? (searchReason?.startsWith('searching_') ? searchReason.slice(10) : 'no_response') :
    ['stale_pose','frame_gap'].includes(reason) ? 'slow' : reason;
  if (!Object.hasOwn(guidance,key)) return null;
  const value = guidance[key];
  const [title,instruction] = value;
  const message = timeout ? '15秒以内に確認できず停止しました。' +
    (key === 'no_response' ? '原因はまだ確認できていません。' : '最後の確認：' + title) + instruction : title + instruction;
  return {title,instruction,message};
}
