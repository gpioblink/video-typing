'use strict';

const uuid = require('uuid');
const AWS = require('aws-sdk');

AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.getvideo = (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  const siteUrl = requestBody.url;
  const sourceJson = requestBody.source;

  if(typeof siteUrl !== 'string' || typeof sourceJson !== 'string') {
    console.error('Validation Failed');
    callback(new Error('Couldn\'t submit video source because of validation errors.'));
    return;
  }

  submitVideoSourceP(videoSourceInfo(siteUrl,sourceJson))
   .then(res => {
     callback(null, {
       statusCode: 200,
       headers: {
        'Access-Control-Allow-Origin': '*',
       },
       body: JSON.stringify({
         message: `Sucessfully submitted video source with siteUrl ${siteUrl}`
       })
     });
   })
   .catch(err => {
     console.log(err);
     callback(null, {
       statusCode: 500,
       headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
       },
       body: JSON.stringify({
         message: `Unable to submit video source with siteUrl ${siteUrl}`
       })
     });
   })

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'Go Serverless v1.0! Your function executed successfully!',
        input: event,
      },
      null,
      2
    ),
  };
  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};

const submitVideoSourceP = videoSource => {
  console.log('Submitting video source');
  const videoSourceInfo = {
    TableName: process.env.VIDEO_TYPING_TABLE,
    Item: videoSource,
  };
  return dynamoDb.put(videoSourceInfo).promise()
   .then(res => videoSource);
};

const videoSourceInfo = (siteUrl, sourceJson) => {
  const timestamp = new Date().getTime();
  return {
    id: siteUrl,
    source: sourceJson,
    updatedAt: timestamp,
  };
};

module.exports.getVideoCache = (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  const siteUrl = requestBody.url;
  const params = {
    TableName: process.env.VIDEO_TYPING_TABLE,
    Key: {
      id: siteUrl,
    },
  };

  dynamoDb.get(params).promise()
   .then(result => {
     const response = {
       statusCode: 200,
       headers: {
        'Access-Control-Allow-Origin': '*',
       },
       body: JSON.stringify(result.Item),
     };
     callback(null, response);
   })
   .catch(error => {
     console.error(error);
     callback(new Error('Couldn\'t fetch video source'));
     return;
   });
};
