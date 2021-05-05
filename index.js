import axios from 'axios';
import dotenv from 'dotenv';
import twilio from 'twilio';
import personalMobile from './personalMobile.js'; // An of mobile numbers to notify

dotenv.config();

const appendZero = (num) => {
  const inString = String(num);
  return inString.padStart(2, '0');
}

const today = () => `${appendZero(new Date().getDate())}-${appendZero(new Date().getMonth() + 1)}-${new Date().getFullYear()}`;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

const sendAlert = (pincode) => (to) => client.messages
  .create({
    to,
    from: process.env.TWILIO_SOURCE_MOBILE,
    body: 'Appointment available at ' + pincode,
  })
  .then();

const options = (districtId) => ({
  method: 'GET',
  url: 'https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByDistrict',
  params: {district_id: districtId, date: today()},
  headers: {accept: 'application/json', 'Accept-Language': 'hi_IN'}
});

const getAvailabilityFromCentre = (age) => (center) => {
  const { sessions } = center;
  const availableSessions = sessions.filter(({ min_age_limit, available_capacity }) => (available_capacity && (min_age_limit === age)));
  if (availableSessions.length > 0) {
    // Sessions available
    return {
      sessionAvailable: true,
      availableSessions,
      centre: { id: center.center_id, name: center.name, pincode: center.pincode }
    }
  }
  return {
    sessionAvailable: false,
    availableSessions,
    centre: null
  }
}

const sessionAvailableFilter = (({ sessionAvailable }) => sessionAvailable);
const filterAvailableSession = (input) => input.filter(sessionAvailableFilter);

const filterForAge = (age) => (appointmentData) => {
  const { centers } = appointmentData;
  const getAvailabilityFor18 = getAvailabilityFromCentre(age);
  const availableAppointments = filterAvailableSession(centers.map(getAvailabilityFor18));
  return availableAppointments;
};

const getAllAppointments = async (districtId) => {
  try {
    const response = await axios.request(options(districtId));
    const availableAppointments = filterForAge(18)(response.data);
    return {
      sessionAvailable: (availableAppointments.length > 0),
      data: availableAppointments
    }
  } catch (ex) {
    console.error(ex);
    return {
      sessionAvailable: false,
      data: []
    }
  }
};

const sendMessages = async (pincode) => {
  const sendToPincode = sendAlert(pincode);
  await Promise.all(personalMobile.map(sendToPincode));
}

const main = async () => {
  const districtIds = ['505', '506']; // JAIPUR I and II
  const appointmentAvailability = await Promise.all(districtIds.map(getAllAppointments)).then(filterAvailableSession);
  const totalData = appointmentAvailability.reduce((totalAppointments, { data = [] } = {}) => {
    return [...totalAppointments, ...data];
  }, []);
  const formattedData = totalData.reduce(((tillNow, thisSession) => ({
    ...tillNow,
    [thisSession.centre.id]: {
      availableSessions: thisSession.availableSessions,
      ...thisSession.centre
    }
  })), {})
  let foundSlots = false;
  let messagePromise = new Promise((resolve) => resolve(1));
  Object.values(formattedData).forEach(({ pincode, availableSessions }) => {
    if (!foundSlots) {
      foundSlots = true;
      messagePromise = sendMessages(pincode);
    }
    console.log(pincode, ': ', availableSessions);
  });
  await messagePromise;
  return foundSlots;
}

while(true) {
  const foundSlots = await main();
  if (!foundSlots) {
    console.log('No slots found, Timestamp: ', (new Date()).toLocaleTimeString(), ', ', (new Date()).toLocaleDateString())
  } else {
    console.log('Found Slots!!')
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 300000));
  console.log('trying again')
}