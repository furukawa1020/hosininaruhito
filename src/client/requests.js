// Only the current request may update the UI, even if transport ignores abort.
export class RequestSession {
  current = null;
  begin() {
    this.cancel();
    const controller = new AbortController();
    this.current = controller;
    return { signal: controller.signal, isCurrent: () => this.current === controller && !controller.signal.aborted };
  }
  cancel() {
    this.current?.abort();
    this.current = null;
  }
}

export function parseCoordinates(lat, lng) {
  if (lat.trim() === '' || lng.trim() === '') throw new Error('緯度と経度を両方入力してください。');
  const coordinates = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(coordinates.lat) || Math.abs(coordinates.lat) > 90 ||
      !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lng) > 180) {
    throw new Error('緯度は−90〜90、経度は−180〜180で入力してください。');
  }
  return coordinates;
}

