'use strict';

let Service;
let Characteristic;
const url = require('url');
const request = require('request');
const EventSource = require('eventsource');
/* eslint-disable import/no-unresolved */
const firmware = require('./package.json').version;
/* eslint-enable import/no-unresolved */

const communicationError = new Error('Can not communicate with Home Assistant.');

let HomeAssistantAlarmControlPanel;
let HomeAssistantBinarySensorFactory;
let HomeAssistantCoverFactory;
let HomeAssistantFan;
let HomeAssistantLight;
let HomeAssistantLock;
let HomeAssistantMediaPlayer;
let HomeAssistantSensorFactory;
let HomeAssistantSwitch;
let HomeAssistantDeviceTrackerFactory;
let HomeAssistantClimate;

function HomeAssistantPlatform(log, config, api) {
  // auth info
  this.host = config.host;
  this.password = config.password;
  this.supportedTypes = config.supported_types || ['alarm_control_panel', 'automation', 'binary_sensor', 'climate', 'cover', 'device_tracker', 'fan', 'group', 'input_boolean', 'light', 'lock', 'media_player', 'remote', 'scene', 'script', 'sensor', 'switch', 'vacuum'];
  this.foundAccessories = [];
  this.logging = config.logging !== undefined ? config.logging : true;
  this.verify_ssl = config.verify_ssl !== undefined ? config.verify_ssl : true;
  this.log = log;
  if (config.default_visibility === 'hidden' || config.default_visibility === 'visible') {
    this.defaultVisibility = config.default_visibility;
  } else {
    this.defaultVisibility = 'visible';
    this.log.error('Please set default_visibility in config.json to "hidden" or "visible".');
  }

  if (api) {
    // Save the API object as plugin needs to register new accessory via this object.
    this.api = api;
  }

  const es = new EventSource(`${config.host}/api/stream?api_password=${encodeURIComponent(this.password)}`);
  es.addEventListener('message', (e) => {
    if (this.logging) {
      this.log(`Received event: ${e.data}`);
    }
    if (e.data === 'ping') {
      return;
    }

    const data = JSON.parse(e.data);
    if (data.event_type !== 'state_changed') {
      return;
    }

    const numAccessories = this.foundAccessories.length;
    for (let i = 0; i < numAccessories; i++) {
      const accessory = this.foundAccessories[i];

      if (accessory.entity_id === data.data.entity_id && accessory.onEvent) {
        accessory.onEvent(data.data.old_state, data.data.new_state);
      }
    }
  });
}

HomeAssistantPlatform.prototype = {
  request(method, path, options, callback) {
    const requestURL = `${this.host}/api${path}`;
    /* eslint-disable no-param-reassign */
    options = options || {};
    options.query = options.query || {};
    /* eslint-enable no-param-reassign */

    const reqOpts = {
      url: url.parse(requestURL),
      method: method || 'GET',
      qs: options.query,
      body: JSON.stringify(options.body),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.password,
      },
      rejectUnauthorized: this.verify_ssl,
    };

    request(reqOpts, (error, response, body) => {
      if (error) {
        callback(error, response);
        return;
      }

      if (response.statusCode === 401) {
        callback(new Error('You are not authenticated'), response);
        return;
      }

      callback(error, response, JSON.parse(body));
    });
  },
  fetchState(entityID, callback) {
    this.request('GET', `/states/${entityID}`, {}, (error, response, data) => {
      if (error) {
        callback(null);
      } else {
        callback(data);
      }
    });
  },
  callService(domain, service, serviceData, callback) {
    const options = {};
    options.body = serviceData;

    this.request('POST', `/services/${domain}/${service}`, options, (error, response, data) => {
      if (error) {
        callback(null);
      } else {
        callback(data);
      }
    });
  },
  accessories(callback) {
    this.log('Fetching HomeAssistant devices.');

    const that = this;

    this.request('GET', '/states', {}, (error, response, data) => {
      if (error) {
        that.log(`Failed getting devices: ${error}. Retrying...`);
        setTimeout(() => { that.accessories(callback); }, 5000);
        return;
      }

      for (let i = 0; i < data.length; i++) {
        const entity = data[i];
        const entityType = entity.entity_id.split('.')[0];

        /* eslint-disable no-continue */
        // ignore devices that are not in the list of supported types
        if (that.supportedTypes.indexOf(entityType) === -1) {
          continue;
        }

        // if default behavior is visible, then ignore hidden devices
        if (this.defaultVisibility === 'visible' && entity.attributes.homebridge_hidden) {
          continue;
        }
        /* eslint-enable no-continue */

        // support providing custom names
        if (entity.attributes && entity.attributes.homebridge_name) {
          entity.attributes.friendly_name = entity.attributes.homebridge_name;
        }

        let accessory = null;

        if (this.defaultVisibility === 'visible' || (this.defaultVisibility === 'hidden' && entity.attributes.homebridge_visible)) {
          if (entityType === 'light') {
            accessory = new HomeAssistantLight(that.log, entity, that, firmware);
          } else if (entityType === 'switch') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'switch', firmware);
          } else if (entityType === 'lock') {
            accessory = new HomeAssistantLock(that.log, entity, that, firmware);
          } else if (entityType === 'garage_door') {
            that.log.error('Garage_doors are no longer supported by homebridge-homeassistant. Please upgrade to a newer version of Home Assistant to continue using this entity (with the new cover component).');
          } else if (entityType === 'scene') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'scene', firmware);
          } else if (entityType === 'rollershutter') {
            that.log.error('Rollershutters are no longer supported by homebridge-homeassistant. Please upgrade to a newer version of Home Assistant to continue using this entity (with the new cover component).');
          } else if (entityType === 'input_boolean') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'input_boolean', firmware);
          } else if (entityType === 'fan') {
            accessory = new HomeAssistantFan(that.log, entity, that, firmware);
          } else if (entityType === 'cover') {
            accessory = HomeAssistantCoverFactory(that.log, entity, that, firmware);
          } else if (entityType === 'sensor') {
            accessory = HomeAssistantSensorFactory(that.log, entity, that, firmware);
          } else if (entityType === 'device_tracker') {
            accessory = HomeAssistantDeviceTrackerFactory(that.log, entity, that, firmware);
          } else if (entityType === 'climate') {
            accessory = new HomeAssistantClimate(that.log, entity, that, firmware);
          } else if (entityType === 'media_player' && entity.attributes && entity.attributes.supported_features) {
            accessory = new HomeAssistantMediaPlayer(that.log, entity, that, firmware);
          } else if (entityType === 'binary_sensor' && entity.attributes && entity.attributes.device_class) {
            accessory = HomeAssistantBinarySensorFactory(that.log, entity, that, firmware);
          } else if (entityType === 'group') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'group', firmware);
          } else if (entityType === 'alarm_control_panel') {
            accessory = new HomeAssistantAlarmControlPanel(that.log, entity, that, firmware);
          } else if (entityType === 'remote') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'remote', firmware);
          } else if (entityType === 'automation') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'automation', firmware);
          } else if (entityType === 'vacuum') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'vacuum', firmware);
          } else if (entityType === 'script') {
            accessory = new HomeAssistantSwitch(that.log, entity, that, 'script', firmware);
          }
        }

        if (accessory) {
          that.foundAccessories.push(accessory);
        }
      }

      callback(that.foundAccessories);
    });
  },
};

function HomebridgeHomeAssistant(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  /* eslint-disable global-require */
  HomeAssistantLight = require('./accessories/light')(Service, Characteristic, communicationError);
  HomeAssistantSwitch = require('./accessories/switch')(Service, Characteristic, communicationError);
  HomeAssistantLock = require('./accessories/lock')(Service, Characteristic, communicationError);
  HomeAssistantMediaPlayer = require('./accessories/media_player')(Service, Characteristic, communicationError);
  HomeAssistantFan = require('./accessories/fan')(Service, Characteristic, communicationError);
  HomeAssistantCoverFactory = require('./accessories/cover')(Service, Characteristic, communicationError);
  HomeAssistantSensorFactory = require('./accessories/sensor')(Service, Characteristic, communicationError);
  HomeAssistantBinarySensorFactory = require('./accessories/binary_sensor')(Service, Characteristic, communicationError);
  HomeAssistantDeviceTrackerFactory = require('./accessories/device_tracker')(Service, Characteristic, communicationError);
  HomeAssistantClimate = require('./accessories/climate')(Service, Characteristic, communicationError);
  HomeAssistantAlarmControlPanel = require('./accessories/alarm_control_panel')(Service, Characteristic, communicationError);
  /* eslint-enable global-require */

  homebridge.registerPlatform('homebridge-homeassistant', 'HomeAssistant', HomeAssistantPlatform, false);
}

module.exports = HomebridgeHomeAssistant;

module.exports.platform = HomeAssistantPlatform;
