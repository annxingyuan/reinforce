import helpers from './helpers/helpers'
const { flatten, sampleArray, createDictByProp, bindAll } = helpers
import { values } from 'underscore'
import { Nodes } from './nodes'
import { beliefs, maxCyclesInMemory } from './config'
import messageState from './messageState'

const EPS = 0.00001

export default class Node {
	constructor(opts) {
		this.id = opts.id
		this.index = opts.index
		this.username = opts.username
		this.belief = opts.belief
		this.trumporhillary = opts.trumporhillary

		this._following = []
		this._lastFollowing = []
		this._followedBy = []
		this.lastReceivedMessages = []
		this.learningMessage = null
		this._rewards = []
		this.nextAction = null

		this.cycleInterval = Math.round(Math.random() * maxCyclesInMemory)

		this.agent = new RL.DQNAgent(this, {
	    update: 'qlearn',
	    gamma: 0.9, // discount factor, [0, 1)
	    epsilon: 0.2, // initial epsilon for epsilon-greedy policy, [0, 1)
	    alpha: 0.01, // value function learning rate
	    experience_add_every: 10, // number of time steps before we add another experience to replay memory
	    experience_size: 5000, // size of experience replay memory
	    learning_steps_per_iteration: 20,
	    tderror_clamp: 1.0, // for robustness
	    num_hidden_units: 100 // number of neurons in hidden layer
	  })
	}

	set followedBy(newFollowedBy) { this._followedBy = newFollowedBy }

	get followedBy() { return this._followedBy }

	set following(newFollowing) { this._following = newFollowing }

	get following() { return this._following }

	set lastFollowing(newLastFollowing) { this._lastFollowing = newLastFollowing }

	get lastFollowing() { return this._lastFollowing }

	getNumStates() { return beliefs.length }

	getMaxNumActions() { return beliefs.length }

	getState() {
		let counts = beliefs.reduce((acc, curr) => {
			acc[curr] = 0
			return acc
		}, {})

		for(let i=0; i<this._following.length; i++) {
			counts[this._following[i].belief]++
		}

		return values(counts)
	}

	getReward() { // total reach
		if(this.learningMessage && this.learningMessage[1] >= maxCyclesInMemory) {
			return messageState.getMessageReach(this.learningMessage[0])
		}
		return null
	}

	getDiversity() {
		return this.getState().reduce((acc, curr) =>
			acc + Math.pow(((curr / Math.max(EPS, this._following.length)) - (1 / beliefs.length)), 2), 0) / beliefs.length // means squared error
	}

	getMessage() {
		let seedLearning = false
		if(messageState.cycleIndex % maxCyclesInMemory === this.cycleInterval) {
			seedLearning = true
		}

		const message = { 
			orientation: this.belief, 
			retweet: null,
			user: this.id, id: uuid.v4() 
		}

		if(seedLearning) {
			this.learningMessage = [message.id, 0]
		} else { // consider whether to retweet
			// sort the messages you've heard by the quotient
			// retweet the highest one above a certain threshold (which means some notes might not retweet much at all)
			const matchingMessages = this.lastReceivedMessages
				.filter(msg => msg.orientation === this.belief)

			console.log(this.getDiversity())

			if(matchingMessages.length) {
				const { id, user } = sampleArray(matchingMessages)
				message.retweet = { id, user }
			}
		}

		return message
	}

	sendMessages(messages) {
		this.lastReceivedMessages = []
		for(let i=0; i<messages.length; i++) {
			if(this._following.find(d => d.id === messages[i].user)) {
				this.lastReceivedMessages.push(messages[i])
			}
		}
	}

	cycle() {
		if(this.learningMessage) {
			this.learningMessage[1] = this.learningMessage[1] + 1
		}
	}

	setNextAction() {
		const r = this.getReward()
		if(r !== null) {
			const state = this.getState(),
				action = this.agent.act(state)

			this._rewards.push(r) // save the reward to memory

			this.agent.learn(r)

			this.nextAction = action			
		} else {
			this.nextAction = null
		}
	}

	adjustFollowing() {
		if(this.nextAction !== null) {
			this._lastFollowing = this._following.slice()

			// follow someone from the group that the learning agent tells you
			const followingIDs = this._following.map(n => n.id)
			const availableFollowees = Nodes.filter(n =>
				n.belief === beliefs[this.nextAction] && !followingIDs.includes(n.id))

			if(availableFollowees.length) {
				this._following.push(sampleArray(availableFollowees))
			}

			// unfollow someone who never retweets you
			const choppingBlock = []
			for(let i=0; i<this.following.length; i++) {
				if(!messageState.getRetweetCount(this.id, this.following[i].id)) {
					choppingBlock.push(this.following[i].id)
				}
			}

			this._following.splice(
				this._following.findIndex(d => d.id === sampleArray(choppingBlock)), 1)
		}

		this.setNextAction()
	}

	init() {
		bindAll(this, [ "cycle", "getMessage", "sendMessages", "adjustFollowing" ])
	}
}
