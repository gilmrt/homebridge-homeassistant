'use strict';

var Service;
var Characteristic;
var communicationError;

class HomeAssistantDeviceTracker {
  constructor(log, data, client, service, characteristic, onValue, offValue, firmware) {
    // device info
    this.data = data;
    this.entity_id = data.entity_id;
    this.uuid_base = data.entity_id;
    this.firmware = firmware;
    if (data.attributes && data.attributes.friendly_name) {
      this.name = data.attributes.friendly_name;
    } else {
      this.name = data.entity_id.split('.').pop().replace(/_/g, ' ');
    }
    if (data.attributes && data.attributes.homebridge_manufacturer) {
      this.manufacturer = String(data.attributes.homebridge_manufacturer);
    } else {
      this.manufacturer = 'Home Assistant';
    }
    if (data.attributes && data.attributes.homebridge_model) {
      this.model = String(data.attributes.homebridge_model);
    } else {
      this.model = 'Device Tracker';
    }
    if (data.attributes && data.attributes.homebridge_serial) {
      this.serial = String(data.attributes.homebridge_serial);
    } else {
      this.serial = data.entity_id;
    }
    this.entity_type = data.entity_id.split('.')[0];
    this.client = client;
    this.log = log;
    this.service = service;
    this.characteristic = characteristic;
    this.onValue = onValue;
    this.offValue = offValue;
    this.batterySource = data.attributes.homebridge_battery_source;
    this.chargingSource = data.attributes.homebridge_charging_source;
  }

  onEvent(oldState, newState) {
    if (newState.state) {
      this.sensorService.getCharacteristic(this.characteristic)
        .setValue(newState.state === 'home' ? this.onValue : this.offValue, null, 'internal');
    }
  }
  identify(callback) {
    this.log('identifying: ' + this.name);
    callback();
  }
  getState(callback) {
    this.log('fetching state for: ' + this.name);
    this.client.fetchState(this.entity_id, function (data) {
      if (data) {
        callback(null, data.state === 'home' ? this.onValue : this.offValue);
      } else {
        callback(communicationError);
      }
    }.bind(this));
  }
  getBatteryLevel(callback) {
    this.client.fetchState(this.batterySource, (data) => {
      if (data) {
        callback(null, parseFloat(data.state));
      } else {
        callback(communicationError);
      }
    });
  }
  getChargingState(callback) {
    if (this.batterySource && this.chargingSource) {
      this.client.fetchState(this.chargingSource, (data) => {
        if (data) {
          callback(null, data.state.toLowerCase() === 'charging' ? 1 : 0);
        } else {
          callback(communicationError);
        }
      });
    } else {
      callback(null, 2);
    }
  }
  getLowBatteryStatus(callback) {
    this.client.fetchState(this.batterySource, (data) => {
      if (data) {
        callback(null, parseFloat(data.state) > 20 ? 0 : 1);
      } else {
        callback(communicationError);
      }
    });
  }
  getServices() {
    this.sensorService = new this.service();
    this.sensorService
      .getCharacteristic(this.characteristic)
      .on('get', this.getState.bind(this));

    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmware);

    if (this.batterySource) {
      this.batteryService = new Service.BatteryService();
      this.batteryService
        .getCharacteristic(Characteristic.BatteryLevel)
        .setProps({ maxValue: 100, minValue: 0, minStep: 1 })
        .on('get', this.getBatteryLevel.bind(this));
      this.batteryService
        .getCharacteristic(Characteristic.ChargingState)
        .setProps({ maxValue: 2 })
        .on('get', this.getChargingState.bind(this));
      this.batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', this.getLowBatteryStatus.bind(this));
      return [informationService, this.batteryService, this.sensorService];
    }
    return [informationService, this.sensorService];
  }
}

function HomeAssistantDeviceTrackerFactory(log, data, client, firmware) {
  if (!(data.attributes)) {
    return null;
  }
  return new HomeAssistantDeviceTracker(
    log, data, client,
    Service.OccupancySensor,
    Characteristic.OccupancyDetected,
    Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
    Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    firmware
  );
}

function HomeAssistantDeviceTrackerFactoryPlatform(oService, oCharacteristic, oCommunicationError) {
  Service = oService;
  Characteristic = oCharacteristic;
  communicationError = oCommunicationError;

  return HomeAssistantDeviceTrackerFactory;
}

module.exports = HomeAssistantDeviceTrackerFactoryPlatform;
module.exports.HomeAssistantDeviceTrackerFactory = HomeAssistantDeviceTrackerFactory;
