const electron = require('electron');
const ipc = electron.ipcMain;
const dialog = electron.dialog;
const BrowserWindow = electron.BrowserWindow;
const path = require("path");
const fs = require("fs");
const Inklecate = require("./inklecate.js").Inklecate;
const Menu = electron.Menu;
const i18n = require("./i18n/i18n.js");

const electronWindowOptions = {
  width: 1300,
  height: 730,
  minWidth: 350,
  minHeight: 250,
  titleBarStyle: 'hidden',
  webPreferences: {
    preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
    contextIsolation: false,
    nodeIntegration: true,
    enableRemoteModule: true
  }
};

var windows = [];

const recentFilesPath = path.join(electron.app.getPath("userData"), "recent-files.json");

const viewSettingsPath = path.join(electron.app.getPath("userData"), "view-settings.json");


// Overriden by main.js
var events = {
    onRecentFilesChanged:    (files) => {},
    onProjectSettingsChanged: (settings) => {},
    onViewSettingsChanged:   (settings) => {}
};


function ProjectWindow(filePath) {
    const getThemeFromMenu = () => Menu.getApplicationMenu().items.find(
        e => e.label.toLowerCase() === '&view'
    ).submenu.items.find(
        e => e.label.toLowerCase() === 'theme'
    ).submenu.items.find(
        e => e.checked
    ).label.toLowerCase();

    electronWindowOptions.title = i18n._("Inky");
    this.browserWindow = new BrowserWindow(electronWindowOptions);
    this.browserWindow.loadURL("file://" + __dirname + `/../renderer/index.html?filePath=${encodeURIComponent(filePath)}`);
    this.browserWindow.setSheetOffset(49);

    this.safeToClose = false;
    this.mainInkAbsPath = filePath;

    // this.browserWindow.webContents.openDevTools()

    // Existing project at specific path
    if( filePath ) {
        this.browserWindow.webContents.on('dom-ready', () => {
            this.browserWindow.setRepresentedFilename(filePath);
            this.browserWindow.webContents.send('set-project-main-ink-filepath', filePath);

            // Try to load settings
            this.refreshProjectSettings(filePath);
        });
    }

    // New project, new settings
    else {
        this.settings = {};
        if( events.onProjectSettingsChanged )
            events.onProjectSettingsChanged({});
    }

    windows.push(this);

    this.browserWindow.on("close", (event) => {
        if( !this.safeToClose ) {
            event.preventDefault();
            this.tryClose();
        }
    })

    this.browserWindow.on("closed", () => {
        var idx = windows.indexOf(this);
        if( idx != -1 )
            windows.splice(idx, 1);
    });

    // Set up theme/zoom from settings
    this.browserWindow.webContents.on('dom-ready', () => {
        this.browserWindow.send("change-theme", getThemeFromMenu());
        this.zoom(ProjectWindow.getViewSettings().zoom);
    });

    // Project settings may affect menus etc, so we refresh that
    // when changing focus between different windows
    this.browserWindow.on("focus", () => {
        if( events.onProjectSettingsChanged )
            events.onProjectSettingsChanged(this.settings);
    });
}

ProjectWindow.prototype.newInclude = function() {
    this.browserWindow.webContents.send('project-new-include');
}

ProjectWindow.prototype.save = function() {
    console.log("Saving project")
    this.browserWindow.webContents.send('project-save');
}

ProjectWindow.prototype.exportJson = function() {
    this.browserWindow.webContents.send('project-export');
}

ProjectWindow.prototype.exportForWeb = function() {
    this.browserWindow.webContents.send('project-export-for-web');
}

ProjectWindow.prototype.exportJSOnly = function() {
    this.browserWindow.webContents.send('project-export-js-only');
}

ProjectWindow.prototype.tryClose = function() {
    this.browserWindow.webContents.send('project-tryClose');
}

ProjectWindow.prototype.stats = function() {
    this.browserWindow.webContents.send('project-stats');
}

ProjectWindow.prototype.storyPath = function() {
    this.browserWindow.webContents.send("story-path");
}

ProjectWindow.prototype.editData = function() {
    this.browserWindow.webContents.send('edit-data');
}

ProjectWindow.prototype.keyboardShortcuts = function() {
    this.browserWindow.webContents.send('keyboard-shortcuts');
}

ProjectWindow.prototype.finalClose = function() {
    this.safeToClose = true;
    Inklecate.killSessions(this.browserWindow);
    this.browserWindow.close();
}

ProjectWindow.prototype.openDevTools = function() {
    this.browserWindow.webContents.openDevTools();
}

ProjectWindow.prototype.zoom = function(amount) {
    this.browserWindow.webContents.send('zoom', amount);
}

// Try to load up an optional <ink_root_file_name>.settings.json file
ProjectWindow.prototype.refreshProjectSettings = function(rootInkFilePath) {

    let self = this;


    const resolvedRootPath = path.resolve(rootInkFilePath);
    let basePath = rootInkFilePath;
    if( path.extname(resolvedRootPath) == ".ink" ) {
        basePath = rootInkFilePath.substring(0, resolvedRootPath.length-4)
    }
    const settingsPath = basePath + ".settings.json";


    function completeSettings(settings, err) {
        if( events.onProjectSettingsChanged ) {
            events.onProjectSettingsChanged(settings);
        }

        self.browserWindow.send("project-settings-changed", self.settings);

        if( err ) {
            dialog.showErrorBox("Project Settings Error", err);
        }
    }

    fs.stat(settingsPath, (err, stats) => {
        if( err || !stats.isFile() ) {
            events.onProjectSettingsChanged({});
            return;
        }

        fs.readFile(settingsPath, "utf8", (err, fileContent) => {

            if( err ) {
                completeSettings({}, "File read error - failed to load project settings file at: "+settingsPath);
                return;
            }
            if( !fileContent ) {
                completeSettings({}, "Project settings file appeared to be empty: "+settingsPath);
                return;
            }

            let settings = {};
            try {
                settings = JSON.parse(fileContent);
            } catch(error) {
                completeSettings({}, "Project settings file appeared to be invalid JSON: "+settingsPath+": "+error);
                return;
            }

            self.settings = settings;

            completeSettings(settings);
        });

    });
}


ProjectWindow.all = () => windows;

ProjectWindow.setEvents = function(newEvents) {
    events = newEvents
}


ProjectWindow.createEmpty = function() {
    return new ProjectWindow();
}

ProjectWindow.focused = function() {
    var browWin = BrowserWindow.getFocusedWindow();
    if( browWin )
        return ProjectWindow.withWebContents(browWin.webContents);
    else
        return null;
}


ProjectWindow.withWebContents = function(webContents) {
    if( !webContents )
        return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].browserWindow.webContents === webContents )
            return windows[i];
    }
    return null;
}


ProjectWindow.withMainkInkPath = function(absPath) {
    if( !absPath ) return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].mainInkAbsPath == absPath )
            return windows[i];
    }
    return null;
}


ProjectWindow.getRecentFiles = function() {
    if(!fs.existsSync(recentFilesPath)) {
        return [];
    }
    const json = fs.readFileSync(recentFilesPath, "utf-8");
    try {
        return JSON.parse(json);
    } catch(e) {
        console.error("Error in recent files JSON parsing:", e);
        return [];
    }
}

ProjectWindow.clearRecentFiles = function() {
    if(fs.existsSync(recentFilesPath)) {
        fs.unlinkSync(recentFilesPath);
    }
}

function addRecentFile(filePath) {
    const resolvedFilePath = path.resolve(filePath);
    const recentFiles = ProjectWindow.getRecentFiles();
    const newRecentFiles = recentFiles.indexOf(resolvedFilePath) >= 0 ?
        recentFiles :
        [resolvedFilePath].concat(recentFiles).slice(0, 5);
    fs.writeFileSync(recentFilesPath, JSON.stringify(newRecentFiles), {
        encoding: "utf-8"
    });

    if( events.onRecentFilesChanged ) {
        events.onRecentFilesChanged(newRecentFiles);
    }
}

ProjectWindow.open = async function(filePath) {
    if( !filePath ) {
        var multiSelectPaths = await dialog.showOpenDialog({
            title: i18n._("Open main ink file"),
            properties: ['openFile'],
            filters: [
                { name: i18n._('Ink files'), extensions: ['ink'] }
            ]
        });
        console.log("opening", multiSelectPaths, filePath)
        if( multiSelectPaths && multiSelectPaths.filePaths.length > 0 )
            filePath = multiSelectPaths.filePaths[0];
    }

    // TODO: Could check whether the filepath is relative to any of our
    // existing open projects, and switch to that window?

    console.log("opening", filePath)
    if( filePath) {
        addRecentFile(filePath);
        return new ProjectWindow(filePath);
    }
}

ProjectWindow.getViewSettings = function() {
    if(!fs.existsSync(viewSettingsPath)) {
        return { theme:'light', zoom:'100' };
    }
    const json = fs.readFileSync(viewSettingsPath, "utf-8");
    try {
        return JSON.parse(json);
    } catch(e) {
        console.error('Error in view settings JSON parsing:', e);
        return { theme:'light', zoom:'100' };
    }
}

ProjectWindow.addOrChangeViewSetting = function(name, data){
    const viewSettings = ProjectWindow.getViewSettings();
    viewSettings[name] = data;
    fs.writeFileSync(viewSettingsPath, JSON.stringify(viewSettings), {
        encoding: "utf-8"
    });
    if(events.onViewSettingsChanged) {
        events.onViewSettingsChanged(viewSettings);
    }
}

ipc.on("open-story-file", (_, filePath) => {
    ProjectWindow.open(filePath)
})

ipc.on("main-file-saved", (event, absFilePath) => {
    addRecentFile(absFilePath);

    var win = ProjectWindow.withWebContents(event.sender);
    win.mainInkAbsPath = absFilePath;
    win.refreshProjectSettings(absFilePath);
});

ipc.on("project-final-close", (event) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.finalClose();
});

ipc.on("project-settings-needs-reload", (event, rootInkFilePath) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.refreshProjectSettings(rootInkFilePath);
});

exports.ProjectWindow = ProjectWindow;
