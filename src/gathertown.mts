var _apiKey: string | null = null;

function apiKey(): string {
  if (_apiKey === null) {
    _apiKey = tiled.prompt("Enter Gather API key");
  }
  return _apiKey;
}

function getEditableSpaces() {
  let req = new XMLHttpRequest();
  req.open(
    "GET",
    "https://api.gather.town/api/v2/users/me/spaces?role=DEFAULT_BUILDER",
    false
  );
  req.setRequestHeader("apiKey", apiKey());
  req.responseType = "json";
  req.send();
  if (req.status != 200) {
    throw new Error(`Failed to get editable spaces; status = ${req.status} ${req.statusText}; ${req.responseText}`);
  }
  return req.response;
}
function getMaps(spaceId: string) {
  let req = new XMLHttpRequest();
  req.open(
    "GET",
    `https://api.gather.town/api/v2/spaces/${encodeURIComponent(spaceId)}/maps`,
    false
  );
  req.setRequestHeader("apiKey", apiKey());
  req.responseType = "json";
  req.send();
  if (req.status != 200) {
    throw new Error(`Failed to get maps; status = ${req.status} ${req.statusText}; ${req.responseText}`);
  }
  return req.response;
}

tiled.registerAction("ImportFromGather", function (action) {
  let editableSpaces = getEditableSpaces();
  let spaceId;
  {
    let dialog = new Dialog();
    dialog.windowTitle = "Choose Space";
    let vals = [];
    for (const space of editableSpaces) {
        // vals.push((space.id as string).replace("\\", "/"));
        vals.push((space.id as string).split("\\", 2)[0]);
    }
    dialog.addComboBox("Space Name", vals).currentIndexChanged.connect(
        function (idx) {
            spaceId = vals[idx];
        }
    );
    dialog.addNewRow();
    dialog.addButton("OK").clicked.connect(dialog.accept);
    dialog.addButton("Cancel").clicked.connect(dialog.reject);
    dialog.show();
  }
  let maps = getMaps(spaceId);
  let mapData;
  {
    let dialog = new Dialog();
    dialog.windowTitle = "Choose Map";
    let vals = [];
    for (const m of maps) {
        vals.push(m.name);
    }
    dialog.addComboBox("Map Name", vals).currentIndexChanged.connect(
        function (idx) {
            mapData = maps[idx];
        }
    );
    dialog.addNewRow();
    dialog.addButton("OK").clicked.connect(dialog.accept);
    dialog.addButton("Cancel").clicked.connect(dialog.reject);
    dialog.show();
  }
  // let spaceIdInput = dialog.addTextInput("Space ID");
  // let spaceIdWidget = dialog.addComboBox("Space ID", []);
  // spaceIdWidget.enabled = false;
  // let mapIdInput = dialog.addTextInput("Map ID");

  // let apiKeyVal;
  // apiKeyInput.textChanged.connect(
  //     function (val) {
  //         apiKeyVal = val;
  //     }
  // )

  // apiKeyInput.editingFinished.connect(
  // function () {
  // let req = new XMLHttpRequest();
  // req.open("GET", "https://api.gather.town/api/v2/users/me/spaces?role=DEFAULT_BUILDER", false);
  // req.setRequestHeader("apiKey", apiKeyVal);
  // req.responseType = "json";
  // req.send();
  // let vals = [];
  // for (const space of req.response) {
  // vals.push((space.id as string).replace("\\", "/"));
  // }
  // // dialog.reject();
  // dialog.addComboBox("Space ID", vals);
  // // dialog.show();
  // }
  // )
}).text = "Import from Gather...";

{
  let exportToGather = tiled.registerAction(
    "ExportToGather",
    function (action) {}
  );
  exportToGather.text = "Export to Gather...";
  function updateEnabled(_ = undefined) {
    exportToGather.enabled = !!tiled.activeAsset?.isTileMap;
  }
  updateEnabled();

  tiled.activeAssetChanged.connect(updateEnabled);
}

tiled.extendMenu("File", [
  { action: "ImportFromGather", before: "CloseAll" },
  { action: "ExportToGather" },
  { separator: true },
]);
