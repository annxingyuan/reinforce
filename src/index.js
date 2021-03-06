import { shuffle } from 'underscore'
import helpers from './helpers/helpers'
const { flatten, sampleArray, roundDown, decodeFloat } = helpers
import { scaleOrdinal, schemeCategory10, scaleLinear } from 'd3-scale'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY } from 'd3-force'
import { quadtree as d3quadtree } from 'd3-quadtree'
import { select, selectAll, event } from 'd3-selection'
import { drag as d3drag } from 'd3-drag'
import { range } from 'd3-array'
import { getData } from './api'
import "../main.scss"
import { Nodes, initializeNodes, setFollowedBy, initializeFollowings, saveInitialNodeFollowings, cycle } from './nodes'
// import { initFlot, initNetworkConnectivity, initDiversityChart, initNodeDiversityChart, initAssortativity } from './charts.js'
import { desiredDiversity, cycleDur, width, height } from './config.js'
import './datasetPicker'
import './visualization'
import mediator from './mediator'
import './editableParameters/diversitySlider'
import './editableParameters/controls'
import './editableParameters/friendsFriends'
import './editableParameters/mutual'
import './editableParameters/whetherToUnfollow'

let start, lastCycleTime = 0, rafID = null, animating = false,
  halo = document.querySelector("#halo"),
  popoverElement = document.querySelector("#popover"),
  network_stats = document.querySelector("#network_stats"),
  popoverID = popoverElement.querySelector(".node_id"),
  popoverDiversityOverride = popoverElement.querySelector('.node_diversity_override .count'),
  popoverDiversity = popoverElement.querySelector('.node_diversity .count'),
  popoverFollowees = popoverElement.querySelector('.node_followees .count'),
  popoverFollowers = popoverElement.querySelector('.node_followers .count'),
  popoverInitialConnections = popoverElement.querySelector('.node_initial_connections .count'),
  quadtree = d3quadtree(),
  renderer = new THREE.WebGLRenderer({ alpha: true, canvas: document.querySelector("#webgl-canvas") }),
  scene = new THREE.Scene(),
  camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 10000),
  nodePositions, nodeSizesColors,
  edgeGeometry, nodeGeometry,
  edgeColorsStartTimes, edgeColorsStartTimesBuffer,
  edgeVertices, lastOccupiedEdgeVertexIndex,
  nodePositionBuffer, edgeVerticesBuffer, nodeSizesColorsBuffer,
  force = forceSimulation(),
  emptyNode = new THREE.Vector2(),
  links, nodeData, edgeData,
  globalJaccardInitialCurrFollowing = 0,
  cycleSID = null,
  updateLinksSID = null, updateLinksNodeIndex = 0,
  maxFollowedByLength = 0, minFollowedByLength = Infinity,
  nodeSizeScale = scaleLinear().range([5, 25]).clamp(true),
  peakTime = 250.0, totalTime = 350.0,
  canvasLeft = 0, canvasTop = 0, match,
  lineSegments, points,
  nodeMaterial, edgeMaterial

window.activeNode = null

scene.add(camera)
camera.position.z = 1000

renderer.setSize(width, height)
renderer.setPixelRatio(window.devicePixelRatio)

const updateMinMaxFollowedBy = length => {
  if(length > maxFollowedByLength) maxFollowedByLength = length
  if(length < minFollowedByLength) minFollowedByLength = length
}
const { top, left } = document.querySelector("#webgl-canvas").getBoundingClientRect()

const loop = () => {
  const d = Date.now() - start

  let shouldUpdate = Math.random() < 0.5 // perf
  if(!animating) shouldUpdate = false

  edgeMaterial.uniforms['uTime'].value = d

  if(animating) {
    links = []
    for(let i=0; i<Nodes.length; i++) {
      let n = Nodes[i]
      if(n.following.length) {
        for(let j=0; j<n.following.length; j++) {
          let target
          for(let k=0; k<Nodes.length; k++) {
            if(Nodes[k].id === n.following[j].id) {
              target = Nodes[k]
              break
            }
          }
          links.push({ source: n, target })
        }
      }
    }
  }

  for(let i=0; i<links.length; i++) {
    const link = links[i]
    let source, target
    if(link) {
      source = link.source
      target = link.target
    } else {
      source = emptyNode
      target = emptyNode
    }

    // wrap the below in conditional, e.g. source.index === 0, to highlight only one node

    if(i < lastOccupiedEdgeVertexIndex) {
      edgeVertices[i * 2 * 3] = source.x - width / 2
      edgeVertices[i * 2 * 3 + 1] = -(source.y - height / 2)
      edgeVertices[i * 2 * 3 + 3] = target.x - width / 2
      edgeVertices[i * 2 * 3 + 4] = -(target.y - height / 2)
    }

    if(window.activeNode) {
      if(source.id === window.activeNode.id) {
        edgeColorsStartTimes[i * 2 * 2 + 1] = d - peakTime
        edgeColorsStartTimes[i * 2 * 2 + 3] = d - peakTime
      }
    } else {
      if(source.newlyFollowing && source.newlyFollowing.length !== source.following.length) {
        const newlyFollowingIDs = source.newlyFollowing.map(d => d.id)

        if(newlyFollowingIDs.indexOf(target.id) > -1) {
          if((d - edgeColorsStartTimes[i * 2 * 2 + 1] > cycleDur) && (d - edgeColorsStartTimes[i * 2 * 2 + 3] > cycleDur)) {
            // source
            edgeColorsStartTimes[i * 2 * 2 + 1] = d - peakTime
            // target
            edgeColorsStartTimes[i * 2 * 2 + 3] = d
          }
        }
      }
    }
  }

  // Compute % of initial following connections that still remain
  let jointJaccardNum = 0
  let jointJaccardDenom = 0
  Nodes.forEach(n => {
    let jaccardValues = n.getSimilarityOfInitialAndCurrFollowingSets()
    jointJaccardNum += jaccardValues[0]
    jointJaccardDenom += jaccardValues[1]
  })

  if(lastOccupiedEdgeVertexIndex > links.length) {
    for(let i=links.length; i<lastOccupiedEdgeVertexIndex; i++) {
      edgeVertices[i * 2 * 3] = 0
      edgeVertices[i * 2 * 3 + 1] = 0
      edgeVertices[i * 2 * 3 + 3] = 0
      edgeVertices[i * 2 * 3 + 4] = 0
    }
  }

  lastOccupiedEdgeVertexIndex = links.length

  if(animating) {
    const diff = d - lastCycleTime
    const targetIndex = Math.max(0, Math.min(Math.round((diff / cycleDur) * Nodes.length), Nodes.length))

    if(targetIndex < updateLinksNodeIndex) { updateLinksNodeIndex = 0 } // wrap around

    for(let i=updateLinksNodeIndex; i<targetIndex; i++) {
      let node = Nodes[i]
      node.adjustFollowing()
      setFollowedBy(node)
    }

    updateLinksNodeIndex = targetIndex
  }

  if(shouldUpdate) {
    force.force("link").links(links)
    force.alphaTarget(0.1).restart()
    quadtree = d3quadtree().extent([[-1, -1], [width, height]])
    minFollowedByLength = Infinity
    maxFollowedByLength = 0
    globalJaccardInitialCurrFollowing = (1 - parseFloat(jointJaccardNum) / jointJaccardDenom) * 100
    network_stats.querySelector(".connection_percent_change_visual").textContent = globalJaccardInitialCurrFollowing.toFixed(1) + '%'
  }

  for(let i=0; i < Nodes.length; i++) {
    let node = Nodes[i]
    let opacity = 254
    if(window.activeNode && node.id !== window.activeNode.id) {
      let mutualFollow = node.following.map(f => f.id).indexOf(window.activeNode.id) > -1 && window.activeNode.following.map(f => f.id).indexOf(node.id) > -1
      if(!mutualFollow) { opacity = 100 }
    }

    nodePositions[i * 2] = node.x - width / 2
    nodePositions[i * 2 + 1] = -(node.y - height / 2)
    nodeSizesColors[i * 2] = nodeSizeScale(node.followedBy.length)
    if(node.belief === "conservative") { // red
      nodeSizesColors[i * 2 + 1] = decodeFloat(254, 25, 83, opacity)
    } else if(node.belief === "liberal") { // blue
      nodeSizesColors[i * 2 + 1] = decodeFloat(0, 190, 254, opacity)
    } else { // white
      nodeSizesColors[i * 2 + 1] = decodeFloat(254, 254, 254, opacity)
    }

    if(window.activeNode && node.id === window.activeNode.id) {
      halo.style.transform = `translate3d(${canvasLeft + node.x - 6}px, ${canvasTop + node.y - 6}px, 0)`
    }

    if(shouldUpdate) {
      quadtree.add([node.x, node.y, node])
      // initNetworkConnectivity(Nodes)
      updateMinMaxFollowedBy(node.followedBy.length)
    }
  }

  nodeSizeScale.domain([minFollowedByLength, maxFollowedByLength])
  edgeVerticesBuffer.needsUpdate = true
  edgeColorsStartTimesBuffer.needsUpdate = true
  nodePositionBuffer.needsUpdate = true
  nodeSizesColorsBuffer.needsUpdate = true
  renderer.render(scene, camera)

  if(animating) {
    rafID = requestAnimationFrame(loop)
  }
}

const initialize = () => {
  canvasTop = top
  canvasLeft = left

  edgeGeometry = new THREE.BufferGeometry()
  nodeGeometry = new THREE.BufferGeometry()

  nodeMaterial = new THREE.ShaderMaterial({
    vertexShader: document.getElementById("node-vertexshader").textContent,
    fragmentShader: document.getElementById("node-fragmentshader").textContent,
    transparent: true
  })

  edgeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      peakTime: { value: peakTime },
      totalTime: { value: totalTime },
      defaultOpacity: { value: 0.08 },
      color: {
        type: 'c',
        value: new THREE.Color(0xABABBF)
      }
    },
    vertexShader: document.getElementById("edge-vertexshader").textContent,
    fragmentShader: document.getElementById("edge-fragmentshader").textContent,
    transparent: true
  })

  nodePositions = new Float32Array(Nodes.length * 2)
  nodeSizesColors = new Float32Array(Nodes.length * 2)
  edgeVertices = new Float32Array(edgeData.length * 2 * 6)
  edgeColorsStartTimes = new Float32Array(edgeData.length * 2 * 4)

  nodePositionBuffer = new THREE.BufferAttribute(nodePositions, 2)
  nodeGeometry.addAttribute("position", nodePositionBuffer)
  nodeSizesColorsBuffer = new THREE.BufferAttribute(nodeSizesColors, 2)
  nodeGeometry.addAttribute("sizeColor", nodeSizesColorsBuffer)

  edgeVerticesBuffer = new THREE.BufferAttribute(edgeVertices, 3)
  edgeColorsStartTimesBuffer = new THREE.BufferAttribute(edgeColorsStartTimes, 2)

  edgeGeometry.addAttribute("position", edgeVerticesBuffer)
  edgeGeometry.addAttribute("colorTime", edgeColorsStartTimesBuffer)

  lineSegments = new THREE.LineSegments(edgeGeometry, edgeMaterial)
  scene.add(lineSegments)
  points = new THREE.Points(nodeGeometry, nodeMaterial)
  scene.add(points)

  force.nodes(Nodes)
    .force("link", forceLink().id(d => d.id))
    .force("charge", forceManyBody().strength(-10).distanceMax(200))
    .force("center", forceCenter(width / 2, height / 2))
    .force("vertical", forceY().strength(0.01))
    .force("horizontal", forceX().strength(0.01))
    .velocityDecay(0.6)

  links = edgeData

  links.forEach(l => {
    const source = Nodes.find(n => n.id === +l.source)
    const target = Nodes.find(n => n.id === +l.target)
    target.following = target.following.concat(source)
  })

  Nodes.forEach(n => n.init())
  Nodes.forEach(n => saveInitialNodeFollowings(n))
  // initFlot(Nodes[20]);
  // initAssortativity(Nodes)

}

const play = () => {
  animating = true
  cycleSID = setInterval(() => {
    lastCycleTime = Date.now() - start
    cycle()
  }, cycleDur)
  rafID = requestAnimationFrame(loop)
}

const pause = () => {
  animating = false
  force.stop()
  window.clearInterval(cycleSID)
  window.cancelAnimationFrame(rafID)
}

const stop = () => {
  pause()

  mediator.publish("stopped")
}

const revealHalo = (x, y) => {
  halo.style.transform = `translate3d(${x - 6}px, ${y - 6}px, 0)`
  halo.classList.add("active")
}

const removeHalo = () => {
  halo.classList.remove("active")
}

document.addEventListener("mousemove", e => {
  e.preventDefault()
  popoverElement.style.left = e.pageX + 'px'
  popoverElement.style.top = e.pageY + 'px'

  match = quadtree.find(e.pageX - canvasLeft, e.pageY - canvasTop, 3)
  if(match) {
    let node = match[2]
    const diversity = node.diversity
    const target = node.diversityOverride === null ? node.desiredDiversity : node.diversityOverride
    let jaccardValues = node.getSimilarityOfInitialAndCurrFollowingSets()
    let jaccardChange = (1 - parseFloat(jaccardValues[0]) / jaccardValues[1]) * 100
    popoverElement.style.display = 'block'
    popoverFollowees.innerHTML = node.following.length
    popoverFollowers.innerHTML = node.followedBy.length
    popoverID.innerHTML = "node " + node.id
    popoverDiversity.innerHTML = diversity.toFixed(2)
    popoverInitialConnections.innerHTML = jaccardChange.toFixed(1) + '%'
    popoverDiversityOverride.innerHTML = target.toFixed(2)

    if(diversity > target) {
      popoverElement.setAttribute("data-satisfied", true)
    } else {
      popoverElement.setAttribute("data-satisfied", false)
    }
  } else {
    popoverElement.style.display = 'none'
  }
})

mediator.subscribe("delete-pill", () => {
  window.activeNode = null
  removeHalo()
  if(!animating) { loop() }
})

document.addEventListener("click", e => {
  e.preventDefault()
  if(match) {
    if(window.activeNode && window.activeNode.id === match[2].id) {
      window.activeNode = null
      removeHalo()
      mediator.publish("deactivateNode", match)
    } else {
      window.activeNode = match[2]
      revealHalo(match[0], match[1])
      mediator.publish("activateNode")
    }
    if(!animating) { loop() }
  }
})

mediator.subscribe("converged", () => {
  stop()
  renderer.domElement.classList.add("flash")
  setTimeout(() => {
    renderer.domElement.classList.remove("flash")
  }, 800)
})

mediator.subscribe("play", play)

mediator.subscribe("pause", pause)

mediator.subscribe("selectDataset", dataset => {
  pause()
  window.activeNode = null

  Promise.all([dataset.nodes, dataset.edges].map(getData))
    .then(data => {
      scene.remove(lineSegments)
      scene.remove(points)
      if(lineSegments) {
        edgeGeometry.dispose()
        nodeGeometry.dispose()
        nodeMaterial.dispose()
        edgeMaterial.dispose()
      }

      nodeData = shuffle(data[0])

      nodeData.splice(roundDown(nodeData.length, 3)) // nodes length must be multiple of 3

      edgeData = shuffle(data[1].filter(d =>
        [+d.source, +d.target].every(id => nodeData.find(n => n.node_id === id))))

      edgeData.splice(roundDown(edgeData.length, 3))

      lastCycleTime = 0
      start = Date.now()
      initializeNodes(nodeData, dataset.beliefs)
      initialize()
      removeHalo()
      mediator.publish("data-initialized", edgeData)
    })
})
