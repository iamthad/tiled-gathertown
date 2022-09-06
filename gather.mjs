/// <reference types="@mapeditor/tiled-api" />

/* global tiled */

let HTTP_CACHE = {};
const CACHE_DIR = FileInfo.cleanPath(
  FileInfo.joinPaths(tiled.extensionsPath, "..", "gather-http-cache")
);
const CACHE_FN = FileInfo.joinPaths(CACHE_DIR, "cache.json");
const TILE_PX = 32;

/**
 *
 * @param {Uint8Array} hdr
 */
function suffixFromHeader(hdr) {
  if (hdr[0] == 0x89 && hdr[1] == 0x50 && hdr[2] == 0x4e && hdr[3] == 0x47) {
    return "png";
  }
  if (hdr[0] == 0xff && hdr[1] == 0xd8 && hdr[2] == 0xff) {
    return "jpg";
  }
}

/**
 * @param {XMLHttpRequest} req
 */
function headerMap(req) {
  const lines = req
    .getAllResponseHeaders()
    .trim()
    .split(/[\r\n]+/);
  const res = {};
  lines.forEach((line) => {
    const parts = line.split(": ");
    const header = parts.shift();
    const value = parts.join(": ");
    res[header] = value;
  });
  return res;
}

function pathFromUrl(url) {
  const pat =
    /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/;
  const match = pat.exec(url);
  const auth = match[2];

  let bits = auth.split(".").reverse();

  bits = bits.concat(match[3].split("/"));

  return bits.join("/");
}

/**
 *
 * @param {string} url
 * @param {string} dir
 * @returns string
 */
function saveImage(url, dir) {
  let cacheInfo = { responseHeaders: {} };
  if (HTTP_CACHE.hasOwnProperty(url)) {
    cacheInfo = HTTP_CACHE[url];
  } else {
    HTTP_CACHE[url] = {};
  }

  let req = new XMLHttpRequest();
  req.responseType = "arraybuffer";

  if (cacheInfo.hasOwnProperty("dst") && File.exists(cacheInfo["dst"])) {
    tiled.log("Returning " + url + " from cache.");
    return cacheInfo["dst"];
  }

  // I had trouble making async work
  req.open("GET", url, false);
  req.send();
  HTTP_CACHE[url]["responseHeaders"] = headerMap(req);
  let buf = req.response;
  let arr = new Uint8Array(buf.slice(0, 4));
  let fn = FileInfo.joinPaths(
    CACHE_DIR,
    pathFromUrl(url) + "." + suffixFromHeader(arr)
  );
  File.makePath(FileInfo.path(fn));
  HTTP_CACHE[url]["dst"] = fn;
  tiled.log("Saving to " + fn);
  let dst = new BinaryFile(fn, BinaryFile.WriteOnly);
  dst.write(buf);
  dst.commit();
  return fn;
}

/**
 *
 * @param {any} obj
 * @param {str} fn
 */
function dumpJson(obj, fn) {
  let file = new TextFile(fn, TextFile.WriteOnly);
  file.write(JSON.stringify(obj));
  file.commit();
}

/**
 *
 * @param {str} fn
 * @returns any
 */
function loadJson(fn) {
  let file = new TextFile(fn, TextFile.ReadOnly);
  let res = JSON.parse(file.readAll());
  file.close();
  return res;
}

tiled.registerMapFormat("gather", {
  name: "gather.town map format",
  extension: "json",
  read: (fileName) => {
    File.makePath(CACHE_DIR);
    if (File.exists(CACHE_FN)) {
      let cacheFile = new TextFile(CACHE_FN, TextFile.ReadOnly);
      HTTP_CACHE = JSON.parse(cacheFile.readAll());
      cacheFile.close();
    }

    let dirName = FileInfo.joinPaths(
      FileInfo.path(fileName),
      FileInfo.baseName(fileName) + "_assets"
    );
    File.makePath(dirName);

    let mapData = loadJson(fileName);

    let map = new TileMap();
    map.width = mapData["dimensions"][0];
    map.height = mapData["dimensions"][1];
    map.tileWidth = TILE_PX;
    map.tileHeight = TILE_PX;

    let bgUrl = mapData["backgroundImagePath"];
    if (bgUrl) {
      let bgFn = saveImage(bgUrl, dirName);
      let bg = new ImageLayer("background");
      bg.setImage(new Image(bgFn));
      map.addLayer(bg);
    }

    let fgUrl = mapData["foregroundImagePath"];
    if (bgUrl) {
      let fgFn = saveImage(fgUrl, dirName);
      let fg = new ImageLayer("foreground");
      fg.setImage(new Image(fgFn));
      map.addLayer(fg);
    }

    let ts = new Tileset();
    ts.objectAlignment = Tileset.TopLeft;
    let tilesByUrl = {};
    let objects = new ObjectGroup("objects");
    for (let objData of mapData["objects"]) {
      let object = new MapObject(objData["id"]);
      object.pos = Qt.point(
        objData["x"] * TILE_PX + objData["offsetX"],
        objData["y"] * TILE_PX + objData["offsetY"]
      );
      object.size = Qt.size(
        objData["width"] * TILE_PX,
        objData["height"] * TILE_PX
      );
      var tile;
      let objUrl = objData["normal"];
      if (objUrl in tilesByUrl) {
        tile = tilesByUrl[objUrl];
      } else {
        let normalFn = saveImage(objUrl);
        tile = ts.addTile();
        tile.setImage(new Image(normalFn));
        tilesByUrl[objUrl] = tile;
      }
      object.tile = tile;
      objects.addObject(object);
    }

    map.addLayer(objects);

    dumpJson(HTTP_CACHE, CACHE_FN);

    return map;
  },
});
