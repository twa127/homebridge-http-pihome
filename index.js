var request = require("request");
var http = require('http');
var url = require('url');
var auth = require('http-auth');
var fs = require('fs')
var Service, Characteristic;
var DEFAULT_REQUEST_TIMEOUT = 10000;
var CONTEXT_FROM_PIHOME = "fromHTTPPiHome";
var CONTEXT_FROM_TIMEOUTCALL = "fromTimeoutCall";
var DEFAULT_SENSOR_TIMEOUT = 5000;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-http-pihome", "HttpPiHome", HttpPiHomePlatform);
  homebridge.registerAccessory("homebridge-http-pihome", "HttpPiHomeSensor", HttpPiHomeSensorAccessory);
  homebridge.registerAccessory("homebridge-http-pihome", "HttpPiHomeSwitch", HttpPiHomeSwitchAccessory);
  homebridge.registerAccessory("homebridge-http-pihome", "HttpPiHomeThermostat", HttpPiHomeThermostatAccessory);
};

function HttpPiHomePlatform(log, config) {
  this.log = log;
  this.cacheDirectory = config["cache_directory"] || "./.node-persist/storage";
  this.pihomePort = config["pihome_port"] || 51828;
  this.sensors = config["sensors"] || [];
  this.switches = config["switches"] || [];
  this.thermostats = config["thermostats"] || [];
  this.httpAuthUser = config["http_auth_user"] || null;
  this.httpAuthPass = config["http_auth_pass"] || null;
  this.storage = require('node-persist');
  this.storage.initSync({
    dir : this.cacheDirectory
  });
}

HttpPiHomePlatform.prototype = {

  accessories : function(callback) {
    var accessories = [];
    for (var i = 0; i < this.sensors.length; i++) {
      var sensor = new HttpPiHomeSensorAccessory(this.log, this.sensors[i], this.storage);
      accessories.push(sensor);
    }

    for (var i = 0; i < this.switches.length; i++) {
      var switchAccessory = new HttpPiHomeSwitchAccessory(this.log, this.switches[i], this.storage);
      accessories.push(switchAccessory);
    }

    for (var i = 0; i < this.thermostats.length; i++) {
      var thermostatAccessory = new HttpPiHomeThermostatAccessory(this.log, this.thermostats[i], this.storage);
      accessories.push(thermostatAccessory);
    }

    var accessoriesCount = accessories.length;

    callback(accessories);
    
    var createServerCallback = (function(request, response) {
      var theUrl = request.url;
      var theUrlParts = url.parse(theUrl, true);
      var theUrlParams = theUrlParts.query;
      var body = [];
      request.on('error', (function(err) {
        this.log("[ERROR Http PiHome Server] Reason: %s.", err);
      }).bind(this)).on('data', function(chunk) {
        body.push(chunk);
      }).on('end', (function() {
        body = Buffer.concat(body).toString();

        response.on('error', function(err) {
          this.log("[ERROR Http PiHome Server] Reason: %s.", err);
        });

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');

        if (!theUrlParams.accessoryId) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/plain");
          var errorText = "[ERROR Http PiHome Server] No accessoryId in request.";
          this.log(errorText);
          response.write(errorText);
          response.end();
        }
        else {
          var responseBody = {
            "success" : true
          };
          var accessoryId = theUrlParams.accessoryId;
          for (var i = 0; i < accessoriesCount; i++) {
            var accessory = accessories[i];
            if (accessory.id === accessoryId) {
              if (accessory.type == "thermostat") {
                if (theUrlParams.currenttemperature != null) {
                  var cachedCurTemp = this.storage.getItemSync("http-pihome-current-temperature-" + accessoryId);
                  if (cachedCurTemp === undefined) {
                    cachedCurTemp = 0;
                  }
                  this.storage.setItemSync("http-pihome-current-temperature-" + accessoryId, theUrlParams.currenttemperature);
                  if (cachedCurTemp !== theUrlParams.currenttemperature) {
                    accessory.changeCurrentTemperatureHandler(theUrlParams.currenttemperature);
                  }
                }
                if (theUrlParams.targettemperature != null) {
                  var cachedCurTemp = this.storage.getItemSync("http-pihome-target-temperature-" + accessoryId);
                  if (cachedCurTemp === undefined) {
                    cachedCurTemp = 10;
                  }
                  this.storage.setItemSync("http-pihome-target-temperature-" + accessoryId, theUrlParams.targettemperature);
                  if (cachedCurTemp !== theUrlParams.targettemperature) {
                    accessory.changeTargetTemperatureHandler(theUrlParams.targettemperature);
                  }
                }
                if (theUrlParams.currentstate != null) {
                  var cachedState = this.storage.getItemSync("http-pihome-current-heating-cooling-state-" + accessoryId);
                  if (cachedState === undefined) {
                    cachedState = Characteristic.CurrentHeatingCoolingState.OFF;
                  }
                  this.storage.setItemSync("http-pihome-current-heating-cooling-state-" + accessoryId, theUrlParams.currentstate);
                  if (cachedState !== theUrlParams.currentstate) {
                    accessory.changeCurrentHeatingCoolingStateHandler(theUrlParams.currentstate);
                  }
                }
                if (theUrlParams.targetstate != null) {
                  var cachedState = this.storage.getItemSync("http-pihome-target-heating-cooling-state-" + accessoryId);
                  if (cachedState === undefined) {
                    cachedState = Characteristic.TargetHeatingCoolingState.OFF;
                  }
                  this.storage.setItemSync("http-pihome-target-heating-cooling-state-" + accessoryId, theUrlParams.targetstate);
                  if (cachedState !== theUrlParams.targetstate) {
                    accessory.changeTargetHeatingCoolingStateHandler(theUrlParams.targetstate);
                  }
                }
                responseBody = {
                  "success" : true
                };
              }
              else {
                if (accessory.type == "temperature") {
                  var cachedValue = this.storage.getItemSync("http-pihome-" + accessoryId);
                  if (cachedValue === undefined) {
                    cachedValue = 0;
                  }
                  if (!theUrlParams.value) {
                    responseBody = {
                      "success" : true,
                      "state" : cachedValue
                    };
                  }
                  else {
                    var value = theUrlParams.value;
                    this.storage.setItemSync("http-pihome-" + accessoryId, value);
                    if (cachedValue !== value) {
                      accessory.changeHandler(value);
                    }
                  }
                }
                else {
                  var cachedState = this.storage.getItemSync("http-pihome-" + accessoryId);
                  if (cachedState === undefined) {
                    cachedState = false;
                  }
                  if (!theUrlParams.state) {
                    responseBody = {
                      "success" : true,
                      "state" : cachedState
                    };
                  }
                  else {
                    var state = theUrlParams.state;
                    var stateBool = state === "true";
                    this.storage.setItemSync("http-pihome-" + accessoryId, stateBool);
                    // this.log("[INFO Http PiHome Server] State change of '%s'
                    // to '%s'.",accessory.id,stateBool);
                    if (cachedState !== stateBool) {
                      accessory.changeHandler(stateBool);
                    }
                  }
                }
                break;
              }
            }
          }
          response.write(JSON.stringify(responseBody));
          response.end();
        }
      }).bind(this));
    }).bind(this);

    if (this.httpAuthUser && this.httpAuthPass) {
      var httpAuthUser = this.httpAuthUser;
      var httpAuthPass = this.httpAuthPass;
      basicAuth = auth.basic({
        realm : "Auth required"
      }, function(username, password, callback) {
        callback(username === httpAuthUser && password === httpAuthPass);
      });
      if(this.https) {
        https.createServer(basicAuth, sslServerOptions, createServerCallback).listen(this.pihomePort, "0.0.0.0");
      }
      else {
        http.createServer(basicAuth, createServerCallback).listen(this.pihomePort, "0.0.0.0");
      }
    }
    else {
      if(this.https) {
        https.createServer(sslServerOptions, createServerCallback).listen(this.pihomePort, "0.0.0.0");
      }
      else {
        http.createServer(createServerCallback).listen(this.pihomePort, "0.0.0.0");
      }
    }
    this.log("Started server for pihome on port '%s'.", this.pihomePort);
  }
}

function HttpPiHomeSensorAccessory(log, sensorConfig, storage) {
  this.log = log;
  this.id = sensorConfig["id"];
  this.name = sensorConfig["name"];
  this.type = "temperature";
  this.autoRelease = sensorConfig["autoRelease"];
  this.autoReleaseTime = sensorConfig["autoReleaseTime"] || DEFAULT_SENSOR_TIMEOUT;
  this.storage = storage;

  if (this.type === "temperature") {
    this.service = new Service.TemperatureSensor(this.name);
    this.changeHandler = (function(newState) {
      this.log("Change HomeKit value for temperature sensor to '%s'.", newState);
      this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newState, undefined, CONTEXT_FROM_PIHOME);
    }).bind(this);
    this.service.getCharacteristic(Characteristic.CurrentTemperature).setProps({
      minValue : -100,
      maxValue : 140
    }).on('get', this.getState.bind(this));
  }
}

HttpPiHomeSensorAccessory.prototype.getState = function(callback) {
  this.log("Getting current state for '%s'...", this.id);
  var state = this.storage.getItemSync("http-pihome-" + this.id);
  this.log("State for '%s' is '%s'", this.id, state);
  if (state === undefined) {
    state = false;
  }
  else {
    callback(null, state);
  }
};

HttpPiHomeSensorAccessory.prototype.getServices = function() {
  return [ this.service ];
};

function HttpPiHomeSwitchAccessory(log, switchConfig, storage) {
  this.log = log;
  this.id = switchConfig["id"];
  this.name = switchConfig["name"];
  this.onURL = switchConfig["on_url"] || "";
  this.onMethod = switchConfig["on_method"] || "GET";
  this.onBody = switchConfig["on_body"] || "";
  this.onForm = switchConfig["on_form"] || "";
  this.onHeaders = switchConfig["on_headers"] || "{}";
  this.offURL = switchConfig["off_url"] || "";
  this.offMethod = switchConfig["off_method"] || "GET";
  this.offBody = switchConfig["off_body"] || "";
  this.offForm = switchConfig["off_form"] || "";
  this.offHeaders = switchConfig["off_headers"] || "{}";
  this.storage = storage;

  this.service = new Service.Switch(this.name);
  this.changeHandler = (function(newState) {
    this.log("Change HomeKit state for switch to '%s'.", newState);
    this.service.getCharacteristic(Characteristic.On).updateValue(newState, undefined, CONTEXT_FROM_PIHOME);
  }).bind(this);
  this.service.getCharacteristic(Characteristic.On).on('get', this.getState.bind(this)).on('set', this.setState.bind(this));
}

HttpPiHomeSwitchAccessory.prototype.getState = function(callback) {
  this.log("Getting current state for '%s'...", this.id);
  var state = this.storage.getItemSync("http-pihome-" + this.id);
  if (state === undefined) {
    state = false;
  }
  callback(null, state);
};

HttpPiHomeSwitchAccessory.prototype.setState = function(powerOn, callback, context) {
  this.log("Switch state for '%s'...", this.id);
  this.storage.setItemSync("http-pihome-" + this.id, powerOn);
  var urlToCall = this.onURL;
  var urlMethod = this.onMethod;
  var urlBody = this.onBody;
  var urlForm = this.onForm;
  var urlHeaders = this.onHeaders;

  if (!powerOn) {
    urlToCall = this.offURL;
    urlMethod = this.offMethod;
    urlBody = this.offBody;
    urlForm = this.offForm;
    urlHeaders = this.offHeaders;
  }
  if (urlToCall !== "" && context !== CONTEXT_FROM_PIHOME) {
    var theRequest = {
      method : urlMethod,
      url : urlToCall,
      timeout : DEFAULT_REQUEST_TIMEOUT,
      headers: JSON.parse(urlHeaders)
    };
    if (urlMethod === "POST" || urlMethod === "PUT") {
      if (urlForm) {
        this.log("Adding Form " + urlForm);
        theRequest.form = JSON.parse(urlForm);
      }
      else if (urlBody) {
        this.log("Adding Body " + urlBody);
        theRequest.body = urlBody;
      }
    }
    request(theRequest, (function(err, response, body) {
      var statusCode = response && response.statusCode ? response.statusCode : -1;
      this.log("Request to '%s' finished with status code '%s' and body '%s'.", urlToCall, statusCode, body, err);
      if (!err && statusCode == 200) {
        callback(null);
      }
      else {
        callback(err || new Error("Request to '" + urlToCall + "' was not succesful."));
      }
    }).bind(this));
  }
  else {
    callback(null);
  }
};

HttpPiHomeSwitchAccessory.prototype.getServices = function() {
  return [ this.service ];
};

function HttpPiHomeThermostatAccessory(log, thermostatConfig, storage) {
  this.log = log;
  this.id = thermostatConfig["id"];
  this.name = thermostatConfig["name"];
  this.type = "thermostat";
  this.setTargetTemperatureURL = thermostatConfig["set_target_temperature_url"] || "";
  this.setTargetTemperatureMethod = thermostatConfig["set_target_temperature_method"] || "GET";
  this.setTargetTemperatureBody = thermostatConfig["set_target_temperature_body"] || "";
  this.setTargetTemperatureForm = thermostatConfig["set_target_temperature_form"] || "";
  this.setTargetTemperatureHeaders = thermostatConfig["set_target_temperature_headers"] || "{}";
  this.setTargetHeatingCoolingStateURL = thermostatConfig["set_target_heating_cooling_state_url"] || "";
  this.setTargetHeatingCoolingStateMethod = thermostatConfig["set_target_heating_cooling_state_method"] || "GET";
  this.setTargetHeatingCoolingStateBody = thermostatConfig["set_target_heating_cooling_state_body"] || "";
  this.setTargetHeatingCoolingStateForm = thermostatConfig["set_target_heating_cooling_state_form"] || "";
  this.setTargetHeatingCoolingStateHeaders = thermostatConfig["set_target_heating_cooling_state_headers"] || "{}";
  this.storage = storage;
  this.service = new Service.Thermostat(this.name);
  this.changeCurrentTemperatureHandler = (function(newTemp) {
    this.log("Change current Temperature for thermostat to '%d'.", newTemp);
    this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(newTemp, undefined, CONTEXT_FROM_PIHOME);
  }).bind(this);
  this.changeTargetTemperatureHandler = (function(newTemp) {
    this.log("Change target Temperature for thermostat to '%d'.", newTemp);
    this.service.getCharacteristic(Characteristic.TargetTemperature).updateValue(newTemp, undefined, CONTEXT_FROM_PIHOME);
  }).bind(this);
  this.changeCurrentHeatingCoolingStateHandler = (function(newState) {
    if (newState) {
      this.log("Change Current Heating Cooling State for thermostat to '%s'.", newState);
      this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(newState, undefined, CONTEXT_FROM_PIHOME);
    }
  }).bind(this);
  this.changeTargetHeatingCoolingStateHandler = (function(newState) {
    if (newState) {
      this.log("Change Target Heating Cooling State for thermostat to '%s'.", newState);
      this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(newState, undefined, CONTEXT_FROM_PIHOME);
    }
  }).bind(this);

  this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState).on('get', this.getTargetHeatingCoolingState.bind(this)).on('set', this.setTargetHeatingCoolingState.bind(this));
  this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).on('get', this.getCurrentHeatingCoolingState.bind(this));
  this.service.getCharacteristic(Characteristic.TargetTemperature).on('get', this.getTargetTemperature.bind(this)).on('set', this.setTargetTemperature.bind(this));
  this.service.getCharacteristic(Characteristic.CurrentTemperature).on('get', this.getCurrentTemperature.bind(this));
}

// TargetTemperature
HttpPiHomeThermostatAccessory.prototype.getTargetTemperature = function(callback) {
  this.log("Getting target temperature for '%s'...", this.id);
  var temp = this.storage.getItemSync("http-pihome-target-temperature-" + this.id);
  if (temp === undefined) {
    temp = 20;
  }
  callback(null, temp);
};

HttpPiHomeThermostatAccessory.prototype.setTargetTemperature = function(temp, callback, context) {
  this.log("Target temperature for '%s'...", this.id);
  this.storage.setItemSync("http-pihome-target-temperature-" + this.id, temp);
  var urlToCall = this.setTargetTemperatureURL.replace("%f", temp);
  var urlMethod = this.setTargetTemperatureMethod;
  var urlBody = this.setTargetTemperatureBody;
  var urlForm = this.setTargetTemperatureForm;
  var urlHeaders = this.setTargetTemperatureHeaders;
  if (urlToCall !== "" && context !== CONTEXT_FROM_PIHOME) {
    var theRequest = {
      method : urlMethod,
      url : urlToCall,
      timeout : DEFAULT_REQUEST_TIMEOUT,
      headers: JSON.parse(urlHeaders)
    };
    if (urlMethod === "POST" || urlMethod === "PUT") {
      if (urlForm) {
        this.log("Adding Form " + urlForm);
        theRequest.form = JSON.parse(urlForm);
      }
      else if (urlBody) {
        this.log("Adding Body " + urlBody);
        theRequest.body = urlBody;
      }
    }
    request(theRequest, (function(err, response, body) {
      var statusCode = response && response.statusCode ? response.statusCode : -1;
      this.log("Request to '%s' finished with status code '%s' and body '%s'.", urlToCall, statusCode, body, err);
      if (!err && statusCode == 200) {
        callback(null);
      }
      else {
        callback(err || new Error("Request to '" + urlToCall + "' was not succesful."));
      }
    }).bind(this));
  }
  else {
    callback(null);
  }
};

// Current Temperature
HttpPiHomeThermostatAccessory.prototype.getCurrentTemperature = function(callback) {
  this.log("Getting current temperature for '%s'...", this.id);
  var temp = this.storage.getItemSync("http-pihome-current-temperature-" + this.id);
  if (temp === undefined) {
    temp = 20;
  }
  callback(null, temp);
};

// Target Heating Cooling State
HttpPiHomeThermostatAccessory.prototype.getTargetHeatingCoolingState = function(callback) {
  this.log("Getting current Target Heating Cooling state for '%s'...", this.id);
  var state = this.storage.getItemSync("http-pihome-target-heating-cooling-state-" + this.id);
  if (state === undefined) {
    state = Characteristic.TargetHeatingCoolingState.OFF;
  }
  callback(null, state);
};

HttpPiHomeThermostatAccessory.prototype.setTargetHeatingCoolingState = function(newState, callback, context) {
  this.log("Target Heating Cooling state for '%s'...", this.id);
  this.storage.setItemSync("http-pihome-target-heating-cooling-state-" + this.id, newState);
  var urlToCall = this.setTargetHeatingCoolingStateURL.replace("%b", newState);
  var urlMethod = this.setTargetHeatingCoolingStateMethod;
  var urlBody = this.setTargetHeatingCoolingStateBody;
  var urlForm = this.setTargetHeatingCoolingStateForm;
  var urlHeaders = this.setTargetHeatingCoolingStateHeaders;
  if (urlToCall !== "" && context !== CONTEXT_FROM_PIHOME) {
    var theRequest = {
      method : urlMethod,
      url : urlToCall,
      timeout : DEFAULT_REQUEST_TIMEOUT,
      headers: JSON.parse(urlHeaders)
    };
    if (urlMethod === "POST" || urlMethod === "PUT") {
      if (urlForm) {
        this.log("Adding Form " + urlForm);
        theRequest.form = JSON.parse(urlForm);
      }
      else if (urlBody) {
        this.log("Adding Body " + urlBody);
        theRequest.body = urlBody;
      }
    }
    request(theRequest, (function(err, response, body) {
      var statusCode = response && response.statusCode ? response.statusCode : -1;
      this.log("Request to '%s' finished with status code '%s' and body '%s'.", urlToCall, statusCode, body, err);
      if (!err && statusCode == 200) {
        callback(null);
      }
      else {
        callback(err || new Error("Request to '" + urlToCall + "' was not succesful."));
      }
    }).bind(this));
  }
  else {
    callback(null);
  }
};

// Current Heating Cooling State
HttpPiHomeThermostatAccessory.prototype.getCurrentHeatingCoolingState = function(callback) {
  this.log("Getting current Target Heating Cooling state for '%s'...", this.id);
  var state = this.storage.getItemSync("http-pihome-current-heating-cooling-state-" + this.id);
  if (state === undefined) {
    state = Characteristic.CurrentHeatingCoolingState.OFF;
  }
  callback(null, state);
};

HttpPiHomeThermostatAccessory.prototype.getServices = function() {
  return [ this.service ];
};
