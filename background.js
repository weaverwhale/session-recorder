// ----------
// Constants
// ----------
let currentShopId = ''

// ----------
// Helpers
// ----------
function logger(message, color) {
  color = color || 'black'

  switch (color) {
    case 'success':
      color = 'Green'
      break
    case 'info':
      color = 'DodgerBlue'
      break
    case 'error':
      color = 'Red'
      break
    case 'warning':
      color = 'Orange'
      break
    default:
      color = color
  }

  console.log('%c' + message, 'color:' + color)
}

function convertHeadersArrayToObject(array) {
  const newObj = {}

  array.forEach((header) => {
    newObj[header.name] = header.value
  })

  return newObj
}

function hashCode(s) {
  return Math.abs(
    s.split('').reduce(function (a, b) {
      a = (a << 5) - a + b.charCodeAt(0)
      return a & a
    }, 0),
  )
}

let recordedRequests = {}
function getMode() {
  chrome.storage.local.get('mode', function (items) {
    recordedRequests = {}
    cachedEndpointBodies = {}
    cachedEndpointRequests = []
    chrome.webRequest.onBeforeRequest.removeListener(bodyRecordingFunction)
    chrome.webRequest.onBeforeSendHeaders.removeListener(recordingFunction)
    chrome.webRequest.onBeforeRequest.removeListener(playbackFunction)

    const mode = items.mode

    if (mode === 'record') {
      logger('Record mode', 'info')
      chrome.browserAction.setBadgeBackgroundColor({ color: '#c63e25' })
      chrome.webRequest.onBeforeRequest.addListener(
        bodyRecordingFunction,
        { types: ['xmlhttprequest'], urls: ['<all_urls>'] },
        ['blocking', 'extraHeaders', 'requestBody'],
      )
      chrome.webRequest.onBeforeSendHeaders.addListener(
        recordingFunction,
        { types: ['xmlhttprequest'], urls: ['<all_urls>'] },
        ['blocking', 'requestHeaders'],
      )
    } else if (mode === 'playback') {
      logger('Playback mode', 'info')
      chrome.browserAction.setBadgeBackgroundColor({ color: '#008256' })
      chrome.storage.local.get('recordedRequests', function (items) {
        recordedRequests = items.recordedRequests || {}
        chrome.webRequest.onBeforeRequest.addListener(
          playbackFunction,
          { types: ['xmlhttprequest'], urls: ['<all_urls>'] },
          ['blocking', 'extraHeaders', 'requestBody'],
        )
      })
    } else {
      chrome.storage.local.set({ recordedRequests: {} })
      logger('Mode not set', 'info')
    }
  })
}

function generateKey(details, includeBody) {
  const formattedURL = details.url

  if (includeBody) {
    if (
      details.requestBody &&
      details.requestBody.raw &&
      details.requestBody.raw[0] &&
      details.requestBody.raw[0].bytes
    ) {
      try {
        return `${details.method}:${formattedURL}:${hashCode(
          JSON.parse(
            decodeURIComponent(
              String.fromCharCode.apply(null, new Uint8Array(details.requestBody.raw[0].bytes)),
            ),
          ),
        )}`
      } catch {}

      try {
        return `${details.method}:${formattedURL}:${hashCode(
          JSON.stringify(
            decodeURIComponent(
              String.fromCharCode.apply(null, new Uint8Array(details.requestBody.raw[0].bytes)),
            ),
          ),
        )}`
      } catch {}
    }

    if (typeof includeBody === 'string') {
      return `${details.method}:${formattedURL}:${hashCode(JSON.stringify(includeBody))}`
    }
  }

  return `${details.method}:${formattedURL}`
}

function isGoodRequest(url, method) {
  if (!url || url.includes('chrome') || url.includes('lotties')) return false
  if (method && method === 'OPTIONS') return false
  if (url.includes('schema')) return false
  if (
    url.includes('triplewhale') ||
    url.includes('whale3') ||
    url.includes('shopify') ||
    url.includes('facebook')
  )
    return true
  return false
}

function setCurrentShopId(currentShopId) {
  chrome.storage.local.set({ currentShopId })
}

function setDefaultToken(headers) {
  if (headers && headers.Authorization) {
    chrome.storage.local.set({ token: headers.Authorization })
  }
}

function getToken(headers) {
  if (headers && headers.Authorization) {
    return headers.Authorization
  }

  return chrome.storage.local.get('token', function (items) {
    return items.token
  })
}

function setBadgeText() {
  chrome.storage.local.get('recordedRequests', function (items) {
    const keysSize = Object.keys(items.recordedRequests || {}).length
    chrome.browserAction.setBadgeText({
      text: `${keysSize > 0 ? keysSize : ''}`,
    })
  })
}

// ----------
// Chrome interactions
// ----------
getMode()
setBadgeText()

// Update on storage change
chrome.storage.onChanged.addListener(function (changes) {
  setBadgeText()

  for (let key in changes) {
    if (key === 'mode') {
      getMode()
    }
  }
})

// ----------
// Record Network Requests
// ----------
let cachedEndpointBodies = {}
const bodyRecordingFunction = function (details) {
  const url = details && details.url && details.url?.length > 0 ? details.url : false
  const method = details && details.method ? details.method : false

  if (
    isGoodRequest(url, method) &&
    details.method === 'POST' &&
    details.requestBody &&
    details.requestBody.raw &&
    details.requestBody.raw[0] &&
    details.requestBody.raw[0].bytes &&
    !details.message
  ) {
    const key = generateKey(details)

    try {
      logger(`Success caching body for: ${key}`, 'warning')

      cachedEndpointBodies[key] = JSON.parse(
        decodeURIComponent(
          String.fromCharCode.apply(null, new Uint8Array(details.requestBody.raw[0].bytes)),
        ),
      )
    } catch (e) {
      logger(`Error parsing body: ${e}`, 'error')
    }
  }
}

let cachedEndpointRequests = []
const recordingFunction = function (details) {
  const url = details && details.url && details.url?.length > 0 ? details.url : false
  const method = details && details.method ? details.method : false

  if (isGoodRequest(url, method)) {
    const key = generateKey(details)
    let token = getToken(details.requestHeaders)
    const cacheKey = `${key}${details.requestHeaders}`

    const shopId = details.requestHeaders.find((header) => header.name === 'x-tw-shop-id')
    if (shopId && (currentShopId.length <= 0 || currentShopId !== shopId.value)) {
      currentShopId = shopId.value
      setCurrentShopId(currentShopId)
    }

    if (!cachedEndpointRequests.includes(cacheKey)) {
      cachedEndpointRequests.push(cacheKey)

      var params = {
        method: method,
      }

      if (details.requestHeaders) {
        if (url.includes('https://api.triplewhale.com/') && !token) {
          setDefaultToken(details.requestHeaders)
          token = getToken(details.requestHeaders)
        }

        if (token) params.headers.Authorization = token
        params.headers = convertHeadersArrayToObject(details.requestHeaders)
      }

      if (method === 'POST' && cachedEndpointBodies[key]) {
        params.body = JSON.stringify(cachedEndpointBodies[key])
      }

      try {
        fetch(details.url, params)
          .then((response) => response.text())
          .then((res) => {
            chrome.storage.local.get('recordedRequests', function (items) {
              const recordedRequests = items.recordedRequests || {}
              let didntRecord = false

              if (res && (!res.includes('error') || !(res.error && res.error.length > 0))) {
                const keyWithBody = generateKey(details, params.body)
                if (recordedRequests[key] && keyWithBody) {
                  recordedRequests[keyWithBody] = res
                } else {
                  recordedRequests[key] = res
                }

                chrome.storage.local.set({ recordedRequests: recordedRequests })
                logger(`${details.method} request recorded: ${key}`, 'success')
              } else {
                logger(`${details.method} request could not be recorded: ${key}`, 'error')
                didntRecord = true
              }

              if (method === 'POST' || didntRecord) {
                // As well as on failure,
                // always remove POST requests from cache
                // to allow for new POSTS requests with different bodies to be recorded
                cachedEndpointRequests = cachedEndpointRequests.filter(
                  (item) => item !== key && item !== keyWithBody,
                )
              }
            })
          })
      } catch (e) {
        logger(`Error recording request: ${e}`, 'error')
      }
    }
  }
}

// ----------
// Playback Network Requests
// ----------
const playbackFunction = function (req) {
  if (isGoodRequest(req.url, req.method) && Object.keys(recordedRequests).length > 0) {
    const key = generateKey(req, true)
    const keyWithoutBody = generateKey(req)

    if (key || keyWithoutBody) {
      const recordedResponse = recordedRequests[key]
      const recordedResponseWithoutBody = recordedRequests[keyWithoutBody]

      if (
        (recordedResponse && !recordedResponse.indexOf('message') > -1) ||
        (recordedResponseWithoutBody && !recordedResponseWithoutBody.indexOf('message') > -1)
      ) {
        logger(
          `${req.method} request intercepted: ${
            recordedResponseWithoutBody ? keyWithoutBody : key
          }`,
          'success',
        )

        return {
          redirectUrl:
            'data:text/html;charset=utf-8,' +
            encodeURIComponent(recordedResponse || recordedResponseWithoutBody),
        }
      } else {
        logger(`No recorded response for ${key}`, 'error')
      }
    }
  }
}
