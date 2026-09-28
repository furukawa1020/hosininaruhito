// Resize the complete image without cropping or mirroring. Normalized landmark
// coordinates still refer to the same camera rectangle.
export function createPoseBitmap(video, create = (...args) => createImageBitmap(...args)) {
  const {videoWidth:width, videoHeight:height}=video;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('invalid_frame_size');
  const scale=Math.min(1,640/Math.max(width,height));
  if(scale===1)return create(video);
  return create(video,{resizeWidth:Math.max(1,Math.round(width*scale)),resizeHeight:Math.max(1,Math.round(height*scale)),resizeQuality:'low'});
}
