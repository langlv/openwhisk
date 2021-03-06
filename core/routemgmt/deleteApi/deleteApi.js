/**
 *
 * Copyright 2015-2016 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Delete an API Gateway to action mapping document from the database:
 * https://docs.cloudant.com/document.html#delete
 *
 * Parameters (all as fields in the message JSON object)
 *   gwUrl                Required. The API Gateway base path (i.e. http://gw.com)
 *   gwUser               Optional. The API Gateway authentication
 *   gwPwd                Optional. The API Gateway authentication
 *   namespace            Required if __ow_meta_namespace not specified.  Namespace of API author
 *   __ow_meta_namespace  Required. Namespace of API author
 *   tenantInstance       Optional. Instance identifier used when creating the specific API GW Tenant
 *   basepath             Required. Base path or API name of the API
 *   relpath              Optional. Delete just this relative path from the API.  Required if operation is specified
 *   operation            Optional. Delete just this relpath's operation from the API.
 *
 * NOTE: The package containing this action will be bound to the following values:
 *         gwUrl, gwAuth
 *       As such, the caller to this action should normally avoid explicitly setting
 *       these values
 **/
var utils = require('./utils.js');

function main(message) {

  var badArgMsg = validateArgs(message);
  if (badArgMsg) {
    return Promise.reject(badArgMsg);
  }

  var gwInfo = {
    gwUrl: message.gwUrl,
  };
  if (message.gwUser && message.gwPwd) {
    gwInfo.gwAuth = Buffer.from(message.gwUser+':'+message.gwPwd,'ascii').toString('base64');
  }

  // Set namespace override if provided
  message.namespace = message.__ow_meta_namespace || message.namespace;

  var tenantInstance = message.tenantInstance || 'openwhisk';

  // Log parameter values
  console.log('GW URL        : '+message.gwUrl);
  console.log('GW User       : '+utils.confidentialPrint(message.gwUser));
  console.log('GW Pwd        : '+utils.confidentialPrint(message.gwPwd));
  console.log('__ow_meta_namespace : '+message.__ow_meta_namespace);
  console.log('namespace     : '+message.namespace);
  console.log('tenantInstance: '+message.tenantInstance+' / '+tenantInstance);
  console.log('basepath/name : '+message.basepath);
  console.log('relpath       : '+message.relpath);
  console.log('operation     : '+message.operation);

  // If no relpath (or relpath/operation) is specified, delete the entire API
  var deleteEntireApi = !message.relpath;

  // Delete an API route
  // 1. Get the tenant ID associated with the specified namespace and optional tenant instance
  // 2. Obtain the tenantId/basepath/apiName associated API configuration from the API GW
  // 3. If a relpath or relpath/operation is specified (i.e. delete subset of API)
  //    a. Remove that section from the API config
  //    b. Update API GW with updated API config
  // 4. If relpath or replath/operation is NOT specified (i.e. delete entire API)
  //    a. Delete entire API from API GW
  var tenantId;
  return utils.getTenants(gwInfo, message.namespace, tenantInstance)
  .then(function(tenants) {
    // If a non-empty tenant array was returned, pick the first one from the list
    if (tenants.length === 0) {
      console.error('No Tenant found for namespace '+message.namespace);
      return Promise.reject('No Tenant found for namespace '+message.namespace);
    } else if (tenants.length > 1 ) {
      console.error('Multiple tenants found for namespace '+message.namespace+' and tenant instance '+tenantInstance);
      return Promise.reject('Internal error. Multiple API Gateway tenants found for namespace '+message.namespace+' and tenant instance '+tenantInstance);
    }
    console.log('Got a tenant: '+JSON.stringify(tenants[0]));
    tenantId = tenants[0].id;
    return Promise.resolve(tenants[0].id);
  })
  .then(function(tenantId) {
    console.log('Got Tenant ID: '+tenantId);
    return utils.getApis(gwInfo, tenantId, message.basepath);
  })
  .then(function(apis) {
    console.log('Got '+apis.length+' APIs');
    if (apis.length === 0) {
      console.log('No APIs found for namespace '+message.namespace+' with basepath/apiname '+message.basepath);
      return Promise.reject('API '+message.basepath+' does not exist.');
    } else if (apis.length > 1) {
      console.error('Multiple APIs found for namespace '+message.namespace+' with basepath/apiname '+message.basepath);
      Promise.reject('Internal error. Multiple APIs found for namespace '+message.namespace+' with basepath '+message.basepath);
    }
    return Promise.resolve(apis[0]);
  })
  .then(function(gwApi) {
    if (deleteEntireApi) {
      console.log('Removing entire API '+gwApi.basePath+' from API GW');
      return utils.deleteApiFromGateway(gwInfo, gwApi.id);
    } else {
      console.log('Removing path '+message.relpath+'; operation '+message.operation+' from API '+gwApi.basePath);
      var swaggerApi = utils.generateSwaggerApiFromGwApi(gwApi);
      var endpoint = {
        gatewayMethod: message.operation,
        gatewayPath: message.relpath
      };
      var swaggerOrErrMsg = utils.removeEndpointFromSwaggerApi(swaggerApi, endpoint);
      if (typeof swaggerOrErrMsg === 'string' ) {
        return Promise.reject(swaggerOrErrMsg);
      }
      return utils.addApiToGateway(gwInfo, gwApi.tenantId, swaggerOrErrMsg, gwApi.id);
    }
  })
  .then(function() {
    console.log('deleteApi success');
    return Promise.resolve();
  })
  .catch(function(reason) {
      console.error('API deletion failure: '+reason);
      return Promise.reject('API deletion failure: '+reason);
  });
}


function validateArgs(message) {
  var tmpdoc;
  if(!message) {
    console.error('No message argument!');
    return 'Internal error.  A message parameter was not supplied.';
  }

  if (!message.gwUrl) {
    return 'gwUrl is required.';
  }

  if (!message.__ow_meta_namespace) {
    return '__ow_meta_namespace is required.';
  }

  if (!message.basepath) {
    return 'basepath is required.';
  }

  if (!message.relpath && message.operation) {
    return 'When specifying an operation, the relpath is required.';
  }

  if (message.operation) {
    message.operation = message.operation.toLowerCase();
  }

  return '';
}

module.exports.main = main;
