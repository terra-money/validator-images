import fetch from 'node-fetch';
import stream from 'stream';
import axios from 'axios';
import { promisify } from 'util';
import fs from 'fs';

main()

async function main() {
  var validatorData;

  // Pagination vars
  const limit = 100;
  var offset = 0;

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

      // If LCD match, paginate using `offset`.
      if (lcd == "https://osmosis.feather.network") {
        paginator = `&pagination.offset=${offset}`;
      }

      // Generate validator identities.
      const validatorURL = `${lcd}/cosmos/staking/v1beta1/validators?pagination.limit=${limit}${paginator}`;
      const validatorResponse = await fetch(validatorURL);
      validatorData = await validatorResponse.json();
      const validatorObjects = validatorData['validators'];
      try {
        identitiesArray = validatorObjects.map(a => a.description.identity);
      } catch (err) {
        return err;
      }
      
      // Add identities to Set to filter duplicates.
      identitiesArray.forEach(identitiesSet.add, identitiesSet);

      // Move to next page of validators.
      page += 1;
      offset += limit;
      if (lcd != "https://osmosis.feather.network") {
        paginator = `&pagination.key=${validatorData['pagination']['next_key']}`;
      }
    } while (validatorData['pagination']['next_key']);
  }

  // Turn set into array and remove empty elements.
  identitiesArray = [...identitiesSet].filter(function (el) {
    return el.trim() != '';
  });

  // For each identity value in array, get primary image url,
  // generate download filepath, and download image.
  console.log('\nInvalid identities will be logged below:');
  for (var idx = 0; idx < identitiesArray.length; idx++) {
    const linkResponse = await getLink(identitiesArray[idx]);
    if (linkResponse.filepath) {
      downloadImage(
        linkResponse.imageURL,
        linkResponse.filepath
      );
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

/**
 * Downloads image from imageURL to filepath.
 *
 * @param {string} imageURL URL to validator image.
 * @param {string} filepath Filepath to save validator image.
 */
async function downloadImage(imageURL, filepath) {
  const finishedDownload = promisify(stream.finished);
  const writer = fs.createWriteStream(filepath);

  const response = await axios({
    method: 'GET',
    url: imageURL,
    responseType: 'stream',
    followRedirect: false
  });

  response.data.pipe(writer);
  await finishedDownload(writer);
}

/**
 * Returns imageURL and filepath to download validator image.
 *
 * @param {string} identity Validator alphanumeric identity.
 * @return {string} imageURL URL to validator image.
 * @return {string} filepath Filepath to save validator image.
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

/**
 * Returns LCD endpoints for chains on Station.
 *
 * @return {string[]} lcds LCD endpoint values for chains on Station.
 */
async function getLCDs() {
  const chainResponse = await fetch('https://assets.terra.money/station/chains.json');
  const chainData = await chainResponse.json();

  var lcds = new Array();
  for (const [_, value] of Object.entries(chainData['mainnet'])) {
    lcds.push(value['lcd']);
  }
  return lcds;
}
