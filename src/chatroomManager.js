const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Polari = imports.gi.Polari;
const Tp = imports.gi.TelepathyGLib;

const Lang = imports.lang;
const Signals = imports.signals;

let _singleton = null;

function getDefault() {
    if (_singleton == null)
        _singleton = new _ChatroomManager();
    return _singleton;
}

const _ChatroomManager = new Lang.Class({
    Name: '_ChatroomManager',

    _init: function() {
        this._rooms = {};
        this._activeRoom = null;

        this._app = Gio.Application.get_default();

        this._accountManager = Tp.AccountManager.dup();

        let factory = this._accountManager.get_factory();
        factory.add_channel_features([Tp.Channel.get_feature_quark_group()]);
        factory.add_contact_features([Tp.ContactFeature.ALIAS]);

        this._accountManager.prepare_async(null,
                                           Lang.bind(this, this._onPrepared));
    },

    _onPrepared: function(am, res) {
        try {
            am.prepare_finish(res);
        } catch(e) {
            this._app.release(); // no point in carrying on
        }

        this._observer = Tp.SimpleObserver.new_with_am(am, true,
            'Polari', true, Lang.bind(this, this._observeChannels));

        this._handler = Tp.SimpleHandler.new_with_am(am, false,
            false, 'Polari', false, Lang.bind(this, this._handleChannels));

        let filters = [];

        let roomFilter = {};
        roomFilter[Tp.PROP_CHANNEL_CHANNEL_TYPE] = Tp.IFACE_CHANNEL_TYPE_TEXT;
        roomFilter[Tp.PROP_CHANNEL_TARGET_HANDLE_TYPE] = Tp.HandleType.ROOM;
        filters.push(roomFilter);

        let contactFilter = {};
        contactFilter[Tp.PROP_CHANNEL_CHANNEL_TYPE] = Tp.IFACE_CHANNEL_TYPE_TEXT;
        contactFilter[Tp.PROP_CHANNEL_TARGET_HANDLE_TYPE] = Tp.HandleType.CONTACT;
        filters.push(contactFilter);

        filters.forEach(Lang.bind(this,
            function(f) {
                this._handler.add_handler_filter(f);
                this._observer.add_observer_filter(f);
            }));
        this._handler.register();
        this._observer.register();

        am.connect('account-enabled',
                   Lang.bind(this, this._restoreSavedChannels));
        this._restoreSavedChannels();
    },

    _restoreSavedChannels: function() {
        let settings = new Gio.Settings({ schema: 'org.gnome.polari' });
        let savedChannels = settings.get_value('saved-channel-list').deep_unpack();
        for (let i = 0; i < savedChannels.length; i++) {
            let serializedChannel = savedChannels[i];
            for (let prop in serializedChannel)
                serializedChannel[prop] = serializedChannel[prop].deep_unpack();

            this._restoreChannel(serializedChannel);
        }
    },

    _restoreChannel: function(serializedChannel) {
        let action = this._app.lookup_action('join-room');
        let parameter = GLib.Variant.new('(ssu)',
                                        [serializedChannel.account,
                                         serializedChannel.channel,
                                         0]);
        action.activate(parameter);
    },

    _ensureRoomForChannel: function(channel) {
        let room = this._rooms[channel.get_object_path()];
        if (room)
            return room;

        let room = new Polari.Room({ channel: channel });
        room.channel.connect('invalidated', Lang.bind(this,
            function() {
                this._removeRoom(room);
            }));
        this._addRoom(room);

        return room;
    },

    _processRequest: function(context, connection, channels, processChannel) {
        if (connection.protocol_name != 'irc') {
            let message = 'Not implementing non-IRC protocols';
            context.fail(new Tp.Error({ code: Tp.Error.NOT_IMPLEMENTED,
                                        message: message }));
            return;
        }

        for (let i = 0; i < channels.length; i++) {
            if (channels[i].get_invalidated())
                continue;
            processChannel.call(this, channels[i]);
        }
        context.accept();
    },

    _observeChannels: function() {
        let [observer, account, connection,
             channels, op, requests, context] = arguments;

        this._processRequest(context, connection, channels, Lang.bind(this,
            function(channel) {
                // this is an invitation - only add it in handleChannel
                // if accepted
                if (channel.has_interface(Tp.IFACE_CHANNEL_INTERFACE_GROUP) &&
                    channel.group_self_contact != null)
                    return;
                let room = this._ensureRoomForChannel(channel);
                if (this.roomCount == 1)
                    this.setActiveRoom(room);
            }));
    },

    _handleChannels: function() {
        let [handler, account, connection,
             channels, satisfied, userTime, context] = arguments;

        let [present, time] = Tp.user_action_time_should_present(userTime);

        this._processRequest(context, connection, channels, Lang.bind(this,
            function(channel) {
                let room = this._ensureRoomForChannel(channel);
                //channel.join_async('', null);

                if (present || this.roomCount == 1)
                    this.setActiveRoom(room);
            }));
        if (present)
            this._app.get_active_window().present_with_time(time);
    },

    _addRoom: function(room) {
        if (this._rooms[room.id])
            return;
        this._rooms[room.id] = room;
        this.emit('room-added', room);
    },

    _removeRoom: function(room) {
        if (!this._rooms[room.id])
            return;
        delete this._rooms[room.id];
        this.emit('room-removed', room);
    },

    setActiveRoom: function(room) {
        if (room == this._activeRoom)
            return;

        this._activeRoom = room;
        this.emit('active-changed', room);
    },

    getActiveRoom: function(room) {
        return this._activeRoom;
    },

    getRoomByName: function(name) {
        for (let id in this._rooms)
            if (this._rooms[id].channel.identifier == name)
                return this._rooms[id];
        return null;
    },

    getRoomById: function(id) {
        return this._rooms[id];
    },

    get roomCount() {
        return Object.keys(this._rooms).length;
    }
});
Signals.addSignalMethods(_ChatroomManager.prototype);
