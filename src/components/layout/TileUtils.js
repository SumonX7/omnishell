import Tile from "./Tile.js";
import { buildRectangle } from "../../utils/ui.js";

class TileUtils {
  /**
   * Converts a fractional tile into an absolute rectangle.
   *
   * The width and height used to be rounded independently of the position:
   *
   *   x:     Math.round(container.width * tile.x + container.x),
   *   width: Math.round(container.width * tile.width)
   *
   * On an odd work area that yields a one pixel overlap or gap between two
   * adjacent tiles, which fights the configured inner gap and makes the
   * tiling look misaligned. The width is therefore derived from the two
   * *rounded* edges, so neighbouring tiles always meet exactly.
   */
  static apply_props(tile, container) {
    const x = Math.round(container.width * tile.x + container.x);
    const y = Math.round(container.height * tile.y + container.y);
    const right = Math.round(container.width * (tile.x + tile.width) + container.x);
    const bottom = Math.round(container.height * (tile.y + tile.height) + container.y);
    return buildRectangle({
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    });
  }

  static apply_props_relative_to(tile, container) {
    const x = Math.round(container.width * tile.x);
    const y = Math.round(container.height * tile.y);
    const right = Math.round(container.width * (tile.x + tile.width));
    const bottom = Math.round(container.height * (tile.y + tile.height));
    return buildRectangle({
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    });
  }

  static build_tile(rect, container) {
    return new Tile({
      x: (rect.x - container.x) / container.width,
      y: (rect.y - container.y) / container.height,
      width: rect.width / container.width,
      height: rect.height / container.height,
      groups: []
    });
  }
}

export {
  TileUtils as default
};
