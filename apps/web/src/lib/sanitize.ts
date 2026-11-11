import createDOMPurify from "dompurify"

const forbiddenTags = [
  "audio",
  "base",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "picture",
  "source",
  "style",
  "track",
  "video",
]

// Retain email layout and typography without image-bearing CSS properties.
const presentationStyle =
  /^(?:color|background-color|(?:min-|max-)?(?:width|height)|display|vertical-align|text-(?:align|decoration(?:-line|-color|-style)?|transform|indent)|(?:border|margin|padding)(?:-(?:top|right|bottom|left|block|inline|width|color|style|radius|collapse|spacing))*|font(?:-family|-size|-weight|-style|-variant)?|line-height|letter-spacing|white-space|word-break|overflow-wrap|table-layout|direction|opacity)$/
const remoteImage = /^https?:\/\//i
const embeddedImage = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i

export function sanitizeMail(html: string, allowRemoteImages: boolean) {
  const purifier = createDOMPurify(window)
  const style = document.createElement("span").style
  let blockedImages = false

  purifier.addHook("uponSanitizeAttribute", (node, attr) => {
    if (attr.attrName === "style") {
      style.cssText = attr.attrValue
      const allowed = Array.from(style).filter((key) =>
        presentationStyle.test(key)
      )
      attr.attrValue = allowed
        .map((key) => `${key}:${style.getPropertyValue(key)}`)
        .join(";")
      attr.keepAttr = !!attr.attrValue
    } else if (attr.attrName === "src") {
      const remote = node.nodeName === "IMG" && remoteImage.test(attr.attrValue)
      if (remote && !allowRemoteImages) blockedImages = true
      attr.keepAttr =
        node.nodeName === "IMG" &&
        ((remote && allowRemoteImages) || embeddedImage.test(attr.attrValue))
    } else if (attr.attrName === "href") {
      attr.keepAttr =
        node.nodeName === "A" &&
        /^(?:https?:\/\/|mailto:|tel:)/i.test(attr.attrValue)
    }
  })

  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IMG" && node.hasAttribute("src")) {
      node.setAttribute("referrerpolicy", "no-referrer")
      node.setAttribute("loading", "lazy")
    } else if (node.nodeName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
  })

  const content = purifier
    .sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: forbiddenTags,
      FORBID_ATTR: [
        "attributionsrc",
        "autofocus",
        "background",
        "cite",
        "data",
        "download",
        "formaction",
        "id",
        "longdesc",
        "name",
        "ping",
        "poster",
        "srcset",
      ],
    })
    .trim()
  return { content, blockedImages }
}
