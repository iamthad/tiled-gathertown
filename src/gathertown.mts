const author = "iamthad";
const extname = "tiled-gathertown";
var _proc = new Process();
const homedir = _proc.getEnv("HOME");
const tmpdir =
    tiled.platform == "windows"
        ? _proc.getEnv("TEMP") ||
          _proc.getEnv("TMP") ||
          (_proc.getEnv("SystemRoot") || _proc.getEnv("windir")) + "\\temp"
        : _proc.getEnv("TMPDIR") ||
          _proc.getEnv("TMP") ||
          _proc.getEnv("TEMP") ||
          "/tmp";

const cachedir =
    tiled.platform == "windows"
        ? FileInfo.joinPaths(_proc.getEnv("LOCALAPPDATA"), author, extname)
        : tiled.platform == "macos"
        ? FileInfo.joinPaths(homedir, "Library", "Caches", extname)
        : FileInfo.joinPaths(
              _proc.getEnv("XDG_CACHE_HOME") ||
                  FileInfo.joinPaths(homedir, ".cache"),
              extname
          );
const configdir =
    tiled.platform == "windows"
        ? FileInfo.joinPaths(_proc.getEnv("LOCALAPPDATA"), author, extname)
        : tiled.platform == "macos"
        ? FileInfo.joinPaths(homedir, "Library", "Preferences", extname)
        : FileInfo.joinPaths(
              _proc.getEnv("XDG_CONFIG_HOME") ||
                  FileInfo.joinPaths(homedir, ".config"),
              extname
          );

class GatherApi {
    key: string;
    baseUrl: string;

    constructor(
        key: string,
        baseUrl: string = "https://api.gather.town/api/v2"
    ) {
        this.key = key;
        this.baseUrl = baseUrl;

        const req = new XMLHttpRequest();
        req.open("GET", this.baseUrl, false);
        req.setRequestHeader("apiKey", this.key);
        req.send();
        if (req.status == 403) {
            throw new Error("Invalid API key");
        }
    }

    _request(method: string, path: string): any {
        const req = new XMLHttpRequest();
        req.open(method, `${this.baseUrl}/${path}`, false);
        req.setRequestHeader("accept", "application/json");
        req.setRequestHeader("apiKey", this.key);
        req.responseType = "json";
        req.send();
        return req;
    }

    _get(path: string): any {
        const req = this._request("GET", path);
        if (req.status != 200) {
            throw new Error(
                [
                    `Failed to GET ${this.baseUrl}/${path}`,
                    `HTTP ${req.status}`,
                    req.response_text,
                ].join("; ")
            );
        }
        return req.response;
    }

    getEditableSpaces(): any {
        return this._get("users/me/spaces?role=DEFAULT_BUILDER");
    }

    getMaps(spaceId: string): any {
        return this._get(
            ["spaces", encodeURIComponent(spaceId), "maps"].join("/")
        );
    }
}

function addOkCancel(dialog: Dialog) {
    dialog.addNewRow();
    dialog.addButton("OK").clicked.connect(dialog.accept);
    dialog.addButton("Cancel").clicked.connect(dialog.reject);
}

class GatherIntegration {
    _api: GatherApi | null = null;
    api(): GatherApi {
        if (this._api === null) {
            this._api = new GatherApi(tiled.prompt("Enter Gather API key"));
        }
        return this._api;
    }
    chooseSpace(callback: (spaceId: string) => void): void {
        let dialog = new Dialog("Choose Space");
        let spaceIds: Array<string> = [];
        let spaceLabels: Array<string> = [];
        for (const space of this.api().getEditableSpaces()) {
            let spaceId: string = space.id;
            spaceIds.push(spaceId);
            spaceLabels.push(spaceId.split("\\", 2)[1]);
        }
        let spaceId = spaceIds[0];
        dialog
            .addComboBox("Space Name", spaceLabels)
            .currentIndexChanged.connect((idx) => {
                spaceId = spaceIds[idx];
            });
        addOkCancel(dialog);
        dialog.accepted.connect(() => {
            callback(spaceId);
        });
        dialog.show();
    }
    chooseMap(spaceId: string, callback: (mapData: any) => void): void {
        let maps = this.api().getMaps(spaceId);
        let dialog = new Dialog("Choose Map");
        let mapNames: Array<string> = [];
        for (const m of maps) {
            mapNames.push(m.name);
        }
        let mapData = maps[0];
        dialog
            .addComboBox("Map Name", mapNames)
            .currentIndexChanged.connect((idx) => {
                mapData = maps[idx];
            });
        addOkCancel(dialog);
        dialog.accepted.connect(() => {
            callback(mapData);
        });
        dialog.show();
    }
    chooseOutputDir(callback: (outputDir: string) => void): void {
        let dialog = new Dialog("Choose Output Directory");
        let outputDir: string;
        dialog.addTextInput("Output Directory").textChanged.connect((val) => {
            outputDir = val;
        });
        addOkCancel(dialog);
        dialog.accepted.connect(() => {
            callback(outputDir);
        });
        dialog.show();
    }
}

var integration = new GatherIntegration();

tiled.registerAction("ImportFromGather", function (_) {
    integration.chooseSpace((spaceId: string) => {
        integration.chooseMap(spaceId, function (mapData: any) {
            integration.chooseOutputDir(function (outputDir: string) {
                tiled.log(`mapData=${JSON.stringify(mapData)}`);
                let mapDir = FileInfo.joinPaths(outputDir, mapData.name);
                File.makePath(mapDir);
                let mapFn = FileInfo.joinPaths(mapDir, "map.json");
                let mapFile = new TextFile(mapFn, TextFile.WriteOnly);
                mapFile.write(JSON.stringify(mapData));
                mapFile.commit();
                tiled.open(mapFn);
            });
        });
    });
}).text = "Import from Gather...";

{
    let exportToGather = tiled.registerAction(
        "ExportToGather",
        function (_action) {
            integration.chooseSpace((_spaceId: string) => {});
        }
    );
    exportToGather.text = "Export to Gather...";
    exportToGather.enabled = false;
    // function updateEnabled(_ = undefined) {
    //     exportToGather.enabled = !!tiled.activeAsset?.isTileMap;
    // }
    // updateEnabled();
    // tiled.activeAssetChanged.connect(updateEnabled);
}

tiled.extendMenu("File", [
    { action: "ImportFromGather", before: "Close" },
    { action: "ExportToGather" },
    { separator: true },
]);

let HTTP_CACHE = {};
const CACHE_DIR = FileInfo.cleanPath(
    FileInfo.joinPaths(tiled.extensionsPath, "..", "gather-http-cache")
);
const CACHE_FN = FileInfo.joinPaths(CACHE_DIR, "cache.json");
const TILE_PX = 32;

function suffixFromHeader(hdr: Uint8Array) {
    if (hdr[0] == 0x89 && hdr[1] == 0x50 && hdr[2] == 0x4e && hdr[3] == 0x47) {
        return "png";
    }
    if (hdr[0] == 0xff && hdr[1] == 0xd8 && hdr[2] == 0xff) {
        return "jpg";
    }
}

function headerMap(req: XMLHttpRequest) {
    const lines = req
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/);
    const res = {};
    lines.forEach((line) => {
        const [hdr, val] = line.split(": ", 2);
        res[hdr] = val;
    });
    return res;
}

function pathFromUrl(url: string): string {
    const pat =
        /^(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/;
    const match = pat.exec(url);
    const auth = match[2];

    let bits = auth.split(".").reverse();

    bits = bits.concat(match[3].split("/"));

    return bits.join("/");
}

function saveImage(url: string): string {
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

function dumpJson(obj: any, fn: string): void {
    const file = new TextFile(fn, TextFile.WriteOnly);
    file.write(JSON.stringify(obj));
    file.commit();
}

function loadJson(fn: string): any {
    const file = new TextFile(fn, TextFile.ReadOnly);
    const res = JSON.parse(file.readAll());
    file.close();
    return res;
}

tiled.registerMapFormat("gather", {
    name: "gather.town map format",
    extension: "json",
    read: (fileName) => {
        File.makePath(CACHE_DIR);
        if (File.exists(CACHE_FN)) {
            HTTP_CACHE = loadJson(CACHE_FN);
        }

        let dirName = FileInfo.joinPaths(
            FileInfo.path(fileName),
            `${FileInfo.baseName(fileName)}_assets`
        );
        File.makePath(dirName);

        let mapData = loadJson(fileName);

        let map = new TileMap();
        [map.width, map.height] = mapData.dimensions;
        map.tileWidth = map.tileHeight = TILE_PX;

        let bgUrl = mapData["backgroundImagePath"];
        if (bgUrl) {
            let bgFn = saveImage(bgUrl);
            let bg = new ImageLayer("background");
            bg.setImage(new Image(bgFn));
            map.addLayer(bg);
            let [bgts, bgt] = mapChop(new Image(bgFn), TILE_PX, TILE_PX);
            bgt.name = "background (tiled)";
            map.addLayer(bgt);
        }

        let ts = new Tileset();
        ts.objectAlignment = Tileset.TopLeft;
        let tilesByUrl = {};
        let objects = new ObjectGroup("objects");
        for (let objData of mapData.objects ?? []) {
            let object = new MapObject(objData.id);
            object.pos = Qt.point(
                objData.x * TILE_PX + (objData.offsetX ?? 0),
                objData.y * TILE_PX + (objData.offsetY ?? 0)
            );
            object.size = Qt.size(
                objData.width * TILE_PX,
                objData.height * TILE_PX
            );
            let tile: Tile;
            const objUrl = objData.normal;
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

        let fgUrl = mapData["foregroundImagePath"];
        if (fgUrl) {
            let fgFn = saveImage(fgUrl);
            let fg = new ImageLayer("foreground");
            fg.setImage(new Image(fgFn));
            map.addLayer(fg);
        }

        dumpJson(HTTP_CACHE, CACHE_FN);

        return map;
    },
});

function arrayBufferToStr(buf: ArrayBuffer): string {
    const arr = new Uint8Array(buf);
    const len = arr.byteLength;
    let bstr = "";
    for (let i = 0; i < len; i++) {
        bstr += String.fromCharCode(arr[i]);
    }
    return bstr;
}
function arrayBufferToBase64(buf: ArrayBuffer): string {
    return Qt["btoa"](arrayBufferToStr(buf));
}

function iterRects(
    img: Image,
    tileWidth: number,
    tileHeight: number,
    callback: (img: Image) => void
) {
    const cols = img.width / tileWidth;
    const rows = img.height / tileHeight;
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            callback(
                img.copy(tileWidth * i, tileHeight * j, tileWidth, tileHeight)
            );
        }
    }
}

function paste(dst: Image, src: Image, x: number, y: number) {
    const sw = src.width;
    const sh = src.height;
    for (let j = 0; j < sh; j++) {
        for (let i = 0; i < sw; i++) {
            dst.setPixel(x + i, y + j, src.pixel(i, j));
        }
    }
}

function assembleTileset(tiles: ReadonlyArray<Image>): Tileset {
    const set = new Tileset();

    const n = tiles.length;
    if (!n) return set;

    const rows = Math.ceil(Math.sqrt(n));
    const cols = Math.ceil(n / rows);

    const tw = tiles[0].width;
    const th = tiles[0].height;

    let img = new Image(cols * tw, rows * th, tiles[0].format);

    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
        paste(img, tiles[i], x++ * tw, y * th);
        if (x == cols) {
            x = 0;
            y++;
        }
    }
    set.setTileSize(tw, th);
    set.loadFromImage(img);

    return set;
}

function mapChop(img: Image, tw: number, th: number): [Tileset, TileLayer] {
    let uniq = {};
    let tileRefs: Array<number> = [];
    let tiles: Array<Image> = [];
    iterRects(img, tw, th, (img: Image) => {
        const bstr = arrayBufferToBase64(img.saveToData("png"));
        if (bstr in uniq) {
            tileRefs.push(uniq[bstr]);
        } else {
            tileRefs.push((uniq[bstr] = tiles.length));
            tiles.push(img);
        }
    });
    uniq = undefined;

    const set = assembleTileset(tiles);

    let layer = new TileLayer();
    const imgCols = (layer.width = img.width / tw);
    const imgRows = (layer.height = img.height / th);
    let edit = layer.edit();

    let k = 0;
    for (let j = 0; j < imgRows; j++) {
        for (let i = 0; i < imgCols; i++) {
            edit.setTile(i, j, set.tiles[tileRefs[k++]]);
        }
    }
    edit.apply();

    return [set, layer];
}
