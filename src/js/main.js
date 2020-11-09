const getToApi =  (pEmail) =>{
	const url = `https://ltv-data-api.herokuapp.com/api/v1/records.json?email=${pEmail}`;
	const resp =  fetch(url)
	.then(response => response.json())
	.then(data => {
		if( data != []){
			localStorage.setItem('searchResult', JSON.stringify(data));
			window.location.href = "/results.html"
		}
	})
}

const formatPhoneNumber = (pPhone) =>{
	let firstThree = pPhone.substring(0,3);
	let nextDigits = pPhone.substring(3, pPhone.length);
	return `(${firstThree}) ${nextDigits}`;
}

const fillResultData = () =>{
	let result = JSON.parse(localStorage.getItem('searchResult'));
	if(result){
		document.querySelector('#resultName').innerHTML = `${result.first_name} ${result.last_name}`;
		document.querySelector('#description').innerHTML = result.description;
		document.querySelector('#resultAddress').innerHTML = result.address;
		document.querySelector('#resultEmail').innerHTML = result.email;
		

		if(result.phone_numbers.length > 0){
			result.phone_numbers.forEach(phoneNumber => {
				let p = document.createElement('p');
				p.innerHTML = formatPhoneNumber(phoneNumber);
				p.classList.add('mt-10');
				p.classList.add('blue');
				document.querySelector('.phone-numbers-container').append(p);
			});
		}
		else{
			let p = document.createElement('p');
			p.innerHTML = "No phone numbers found.";
			p.classList.add('mt-10');
			document.querySelector('.phone-numbers-container').append(p);
		}
	
		if(result.relatives.length > 0){
			result.relatives.forEach(relative => {
				let p = document.createElement('p');
				p.innerHTML = relative;
				p.classList.add('mt-10');
				document.querySelector('.relatives-container').append(p);
			});
		}
		else{
			let p = document.createElement('p');
			p.innerHTML = "No relatives found.";
			p.classList.add('mt-10');
			document.querySelector('.relatives-container').append(p);
		}
	}
}

document.querySelector('#btnSubmitSearch').addEventListener('click', (e)=>{
	e.preventDefault();
	let email = document.querySelector('#txtEmailAddress').value;
	getToApi(email);
});


if(window.location.pathname === '/results.html'){
	fillResultData();
}

