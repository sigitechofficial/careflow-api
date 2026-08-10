/** Static diagram UI catalog for carer app body map (mirrors care-admin body-map-views). */
export function bodyMapDiagramCatalogForMobile() {
  return {
    diagramTabs: [
      { id: 'standard', label: 'Standing / regions' },
      { id: 'leaning', label: 'Leaning' },
      { id: 'sitting', label: 'Sitting' },
    ],
    viewTabs: [
      { id: 'dual', label: 'Front & back' },
      { id: 'face', label: 'Face', zoom: true },
      { id: 'head_back', label: 'Head (back)', zoom: true },
      { id: 'chest', label: 'Chest', zoom: true },
      { id: 'abdomen', label: 'Abdomen', zoom: true },
      { id: 'torso_back', label: 'Back', zoom: true },
      { id: 'arm_l', label: 'Left arm', zoom: true },
      { id: 'arm_r', label: 'Right arm', zoom: true },
      { id: 'leg_l', label: 'Left leg', zoom: true },
      { id: 'leg_r', label: 'Right leg', zoom: true },
      { id: 'hand_l', label: 'Left hand', zoom: true },
      { id: 'hand_r', label: 'Right hand', zoom: true },
      { id: 'foot_l', label: 'Left foot', zoom: true },
      { id: 'foot_r', label: 'Right foot', zoom: true },
    ],
    postureDiagramPaths: {
      leaning: '/body-map/leaning.svg',
      sitting: '/body-map/sitting.svg',
    },
    prototypeScriptPaths: {
      catalog: '/body-map/catalog.js',
      anatomy: '/body-map/anatomy.js',
      svgInline: '/body-map/svg-inline.js',
    },
    assetBaseHint:
      'Resolve paths against your admin web origin or bundle equivalent assets in the mobile app.',
  };
}
