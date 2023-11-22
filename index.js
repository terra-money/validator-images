import fetch from 'node-fetch';
import stream from 'stream';
import axios from 'axios';
import { promisify } from 'util';
import fs from 'fs';

main();

async function main() {
  var validatorResponse;
  var validatorData;

  // Limit of validators per page.
  const limit = 100;

  // Identity storage vars.
  var identitiesArray = new Array();
  var identitiesSet = new Set();

  // Create LCD endpoints array.
  const lcds = await getLCDs();

  // For each chain LCD...
  for (var i = 0; i < lcds.length; i++) {
    var paginator = '';
    var lcd = lcds[i];
    var page = 1;

    console.log(`Processing validator identities from LCD: ${lcd}`);

    // Gather validator identities until reaching final page.
    do {
      console.log(`\tPage ${page} processing...`);

      // Generate validator identities.
      const validatorURL = `${lcd}/cosmos/staking/v1beta1/validators?pagination.limit=${limit}${paginator}`;
      try {
        validatorResponse = await fetch(validatorURL);
      } catch (err) {
        console.log(`\nERROR: Unable to fetch ${validatorURL}.\n`)
      }
      try {
        validatorData = await validatorResponse.json();
      } catch (err) {
        console.log(`\nERROR: ${validatorURL} returned an invalid JSON.\n`)
      }
      const validatorObjects = validatorData['validators'];
      try {
        identitiesArray = validatorObjects.map(a => a.description.identity);
      } catch (err) {
        console.log(`\nERROR: ${validatorURL} unable to map identities.\n`);
        continue;
      }
      
      // Add identities to Set to filter duplicates.
      identitiesArray.forEach(identitiesSet.add, identitiesSet);

      // Move to next page of validators.
      paginator = `&pagination.key=${encodeURIComponent(validatorData['pagination']['next_key'])}`;
      page += 1;
    } while (validatorData['pagination']['next_key']);
  }

  // Turn set into array and remove empty elements.
  identitiesArray = [...identitiesSet].filter(function (el) {
    return el.trim() != '';
  });

  // Create Semaphore for image download request queueing.
  const throttler = new Semaphore(2);

  // For each identity value in array, get primary image url,
  // generate download filepath, and download image.
  console.log('\nInvalid identities will be logged below:');
  identitiesArray.map((identity) => {
    throttler.callFunction(downloadImage, identity);
  })
}

const skippedChainIds = ['localterra', 'neutron-1', 'pion-1'];

/**
 * Returns LCD endpoints for chains on Station.
 *
 * @return {string[]} lcds LCD endpoint values for chains on Station.
 */
async function getLCDs() {
  const chainResponse = await fetch('https://station-assets.terra.money/chains.json');
  const chainData = await chainResponse.json();

  var lcds = new Array();

  for (const networkData of Object.values(Object.assign({}, ...Object.values(chainData)))) {
    !skippedChainIds.includes(networkData['chainID']) && lcds.push(networkData['lcd'])
  }

  return lcds;
}

/**
 * Downloads image from imageURL to filepath.
 *
 * @param {string} identity Validator alphanumeric identity.
 */
async function downloadImage(identity) {
  // Extract imageURL and generate filepath using getLink.
  const linkResponse = await getLink(identity);

  // Download image if valid imageURL available.
  if (linkResponse.filepath) {
    const finishedDownload = promisify(stream.finished);
    const writer = fs.createWriteStream(linkResponse.filepath);

    const response = await axios({
      method: 'GET',
      url: linkResponse.imageURL,
      responseType: 'stream',
      followRedirect: false,
    });

    response.data.pipe(writer);
    await finishedDownload(writer);
  }
}

/**
 * Returns imageURL and filepath to download validator image.
 *
 * @param {string} identity Validator alphanumeric identity.
 * @return {object} Object containing URL to validator image and filepath to save validator image.
 */
async function getLink(identity) {
  var fingerprint;
  var imageURL;

  // Use Keybase API to request identity data which contains fingerprint information.
  const identityURL = `https://keybase.io/_/api/1.0/key/fetch.json?pgp_key_ids=${identity}`;
  const identityResponse = await fetch(identityURL);
  const identityData = await identityResponse.json();
  try {
    fingerprint = identityData['keys'][0]['fingerprint'];
  } catch {
    console.log(`\t${identity}`);
    return {'filepath': null};
  }

  // Use Keybase API to request fingerprint data which contains primary image url.
  const fingerprintURL = `https://keybase.io/_/api/1.0/user/lookup.json?key_fingerprint=${fingerprint}`;
  const fingerprintResponse = await fetch(fingerprintURL);
  const fingerprintData = await fingerprintResponse.json();
  try {
    imageURL = fingerprintData['them']['0']['pictures']['primary']['url'];
  } catch {
    try {
      imageURL = fingerprintData['them']['pictures']['primary']['url'];
    } catch {
      return {'filepath': null};
    }
  }

  // Return primary image URL and filepath for file download.
  const filepath = `./images/${identity}.${imageURL.split('.').pop()}`;
  return {
    'imageURL': imageURL,
    'filepath': filepath,
  }
}

/* Semaphore class which handles image download request queueing. */
export default class Semaphore {
  /**
   * Creates a semaphore that limits the number of concurrent Promises being handled.
   * 
   * @param {*} maxConcurrentRequests Max number of concurrent promises being handled at any time.
   */
  constructor(maxConcurrentRequests = 1) {
    this.currentRequests = [];
    this.runningRequests = 0;
    this.maxConcurrentRequests = maxConcurrentRequests;
  }

  /**
   * Returns a Promise that will eventually return the result of the function passed in.
   * Use this to limit the number of concurrent function executions.
   * 
   * @param {*} fnToCall Function that has a cap on the number of concurrent executions.
   * @param {...any} args Any arguments to be passed to fnToCall.
   * @returns Promise that will resolve with the resolved value as if the function passed in was directly called.
   */
  callFunction(fnToCall, ...args) {
    return new Promise((resolve, reject) => {
      this.currentRequests.push({
        resolve,
        reject,
        fnToCall,
        args,
      });
      this.tryNext();
    });
  }

  tryNext() {
    if (!this.currentRequests.length) {
      return;
    } else if (this.runningRequests < this.maxConcurrentRequests) {
      let { resolve, reject, fnToCall, args } = this.currentRequests.shift();
      this.runningRequests++;
      let req = fnToCall(...args);
      req.then((res) => resolve(res))
        .catch((err) => reject(err))
        .finally(() => {
          this.runningRequests--;
          this.tryNext();
        });
    }
  }
}
