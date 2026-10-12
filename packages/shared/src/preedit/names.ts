/**
 * Word lists for spotting people's names in English text so the on-device model does not
 * translate or respell them. A name is only protected when a listed given name is followed
 * by a surname, so the lists favour coverage across cultures over completeness in any one.
 */

const list = (s: string): string[] => s.trim().split(/\s+/);

/** Common given names: English, Arabic, South Asian, Persian, Turkish, African, East Asian, European. */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
  list(`
  James John Robert Michael William David Richard Joseph Thomas Charles Christopher Daniel Matthew
  Anthony Mark Donald Steven Stephen Paul Andrew Joshua Kenneth Kevin Brian George Timothy Ronald
  Edward Jason Jeffrey Ryan Jacob Gary Nicholas Eric Jonathan Larry Justin Scott Brandon Benjamin
  Samuel Gregory Alexander Frank Patrick Raymond Jack Dennis Jerry Tyler Aaron Adam Nathan Henry
  Douglas Zachary Peter Kyle Ethan Walter Noah Jeremy Christian Keith Roger Terry Gerald Harold Sean
  Austin Carl Arthur Lawrence Dylan Jesse Jordan Bryan Billy Joe Bruce Gabriel Logan Albert Alan
  Wayne Elijah Randy Roy Vincent Ralph Eugene Russell Bobby Mason Philip Phillip Louis Liam Oliver
  Lucas Harry Charlie Oscar Leo Freddie Alfie Archie Theo Toby Max Luke Tom Tim Mike Chris Dan Dave
  Steve Rob Ben Sam Nick Matt Andy Tony Jim Jimmy Bill Will Ted Eddie Ian Neil Graham Stuart Colin
  Gordon Martin Simon Craig Ross Gavin Jamie Callum Connor Declan Owen Rhys Gareth Dean Lee Wesley
  Marcus Derek Trevor Shane Clive Nigel Barry Howard Glenn Joel Victor Isaac Caleb Hunter Miles Ray
  Drew Grant Spencer Travis Brett Chad Troy Cody Evan Ivan Felix Hugo Rupert Edmund Alfred Ernest
  Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Nancy Lisa Betty Margaret
  Sandra Ashley Kimberly Emily Donna Michelle Dorothy Carol Amanda Melissa Deborah Stephanie Rebecca
  Sharon Laura Cynthia Kathleen Amy Shirley Angela Helen Anna Brenda Pamela Nicole Emma Samantha
  Katherine Christine Debra Rachel Catherine Carolyn Janet Ruth Maria Heather Diane Virginia Julie
  Joyce Victoria Olivia Kelly Christina Lauren Joan Evelyn Judith Megan Cheryl Andrea Hannah Martha
  Jacqueline Frances Gloria Ann Anne Teresa Kathryn Sara Janice Jean Alice Madison Doris Abigail
  Julia Judy Grace Denise Amber Marilyn Beverly Danielle Theresa Sophia Marie Diana Brittany Natalie
  Isabella Charlotte Rose Alexis Kayla Ava Mia Amelia Isla Ella Chloe Lily Lucy Ellie Freya Ruby
  Holly Zoe Molly Poppy Sophie Georgia Kate Katie Jane Jenny Claire Fiona Gemma Kirsty Leah Paige
  Bethany Abby Jill Sue Liz Beth Ellen Eleanor Harriet Imogen Phoebe Matilda Hope Faith Joy Iris
  Daisy Ivy Summer Dawn Penny Wendy Tracy Stacy Tiffany Vanessa Monica Erica Erin Kristen Caroline
  Sydney Chelsea Jasmine Naomi Esther Miriam Leila
  Mohammed Muhammad Mohamed Mohammad Mohamad Ahmed Ahmad Ali Omar Umar Hassan Hasan Hussein Husain
  Hussain Husein Abdullah Abdulla Abdul Abdel Abdulaziz Abdulrahman Abdelrahman Abdallah Khalid
  Khaled Faisal Fahad Fahd Saud Sultan Salman Nasser Nasir Youssef Yousef Yousif Yusuf Ibrahim
  Ismail Mustafa Mostafa Hamza Bilal Tariq Tarek Karim Kareem Majid Majed Rashid Rashed Saeed Said
  Salem Saleh Salih Sami Samir Walid Waleed Yasser Yasir Ziad Zayed Zaid Zayd Adel Adil Amr Amir
  Anas Ayman Bader Badr Bassam Fawaz Fares Faris Ghassan Hamad Hamid Hamed Hani Haitham Hisham Hazem
  Imad Issa Jamal Jaber Jassim Jasem Kamal Mahmoud Mahmud Mansour Marwan Mazen Mohsen Mounir Munir
  Murad Nabil Naif Nawaf Osama Usama Qasim Rami Raed Riyad Riad Saad Sabah Sharif Suleiman Sulaiman
  Talal Thamer Turki Wael Yahya Yazan Yazid Zakaria Zakariya Mishal Meshal Mubarak Jumah Juma Jumaa
  Abbas Akram Anwar Ashraf Ehab Emad Essam Fadi Fouad Ghanem Habib Hadi Jawad Jihad Kadhim Kazem
  Lutfi Maher Mazin Moataz Muath Mutlaq Nayef Nizar Omran Qais Radwan Ramzi Sabri Sadiq Safwan Shadi
  Taha Tamer Tamim Wasim Yaqoub Yaqub Yasin Yassin Younes Younis Zuhair
  Fatima Fatma Aisha Aysha Ayesha Khadija Maryam Mariam Noor Nour Nora Noura Layla Laila Huda Hana
  Hanan Amal Amira Asma Dana Dina Dalia Farah Ghada Hala Haya Iman Eman Jamila Lama Lina Lubna Maha
  Manal Mona Muna Nada Nadia Najla Nawal Rana Rania Rasha Reem Ruqaya Safa Salma Samar Samira Sana
  Shaikha Sheikha Suad Sumaya Wafa Yasmin Yasmine Zainab Zaynab Zahra Zeinab Lulwa Abeer Afaf Alia
  Aliya Bushra Ghadeer Heba Hiba Jana Joud Lujain Malak Nouf Rawan Razan Ruba Sahar Shahad Tala
  Wafaa Abrar Bayan Dalal Hessa Latifa Maysa Nadine Rima Sawsan Shatha Wejdan Zeina
  Aarav Aditya Ajay Akash Amit Anand Anil Ankit Arjun Arun Ashok Deepak Dev Gaurav Harish Imran
  Irfan Kabir Karan Krishna Kumar Manish Manoj Mukesh Naveen Nikhil Pankaj Pradeep Prakash Rahul
  Raj Rajesh Rajiv Rakesh Ramesh Ravi Rohan Rohit Sachin Sandeep Sanjay Satish Shahid Shankar
  Siddharth Sunil Suresh Tushar Varun Vijay Vikram Vinod Vishal Vivek Yash Zubair Faizan Asif Usman
  Waqar Junaid Kashif Nadeem Naveed Rizwan Shahzad Sohail Tahir Zeeshan Aamir Ananya Anjali Anita
  Divya Deepa Gita Geeta Kavya Kavita Lakshmi Meera Neha Nisha Pooja Priya Priyanka Radha Rekha
  Riya Sangeeta Shreya Sita Sneha Sunita Swati Tanvi Uma Vidya Saima Sadia Rabia Nazia Farzana
  Shabnam Rubina Tahmina Nusrat Sumaiya Arif Rafiq Shafiq Habibur Mizanur Rakib Tanvir Sakib
  Reza Mehdi Hossein Arash Babak Behnam Bijan Cyrus Dariush Darius Farhad Farid Kamran Kaveh Kian
  Masoud Navid Omid Payam Pouya Ramin Saman Shahram Siavash Vahid Azadeh Darya Fereshteh Mahsa
  Mina Nasrin Parisa Roya Shirin Simin Tara Yasaman Golnar Niloufar Mitra Neda Elham Soraya
  Mehmet Ahmet Murat Osman Ramazan Halil Recep Emre Burak Cem Deniz Emir Eren Furkan Kerem Kemal
  Mert Onur Serkan Tolga Volkan Arda Baran Hakan Selim Ayşe Ayse Emine Hatice Zeynep Elif Merve
  Esra Ebru Gizem Selin Dilek Derya Seda Aylin Ece Ceren Defne Melis Nur Hüseyin Süleyman Ömer
  Kwame Kofi Kwabena Kwaku Yaw Ama Akosua Abena Adwoa Efua Chinedu Chidi Chukwuemeka Emeka Obinna
  Ikenna Nnamdi Ngozi Chioma Adaeze Amaka Nkechi Oluwaseun Seun Tunde Babatunde Adebayo Ayodele
  Femi Folake Funmilayo Yemi Bukola Tolu Kehinde Taiwo Abiodun Olumide Segun Musa Aliyu Abubakar
  Garba Fatou Aminata Awa Mariama Moussa Mamadou Ousmane Abdoulaye Cheikh Modou Lamine Sekou Thabo
  Sipho Themba Mandla Lerato Thandiwe Nomvula Zanele Kagiso Tshepo Jabulani Bongani Nokuthula
  Wanjiru Wanjiku Njeri Kamau Otieno Odhiambo Achieng Akinyi Baraka Neema Amani Zawadi Imani Tendai
  Tafadzwa Chipo Kudzai Tsitsi Haile Abebe Tigist Meron Selam Dawit Yonas Bereket
  Wei Jun Hao Lei Jie Ming Hui Xin Ying Jing Fang Hua Tao Yong Qiang Xiaoming Xiaoling Mei
  Hiroshi Takashi Kenji Haruto Yuto Sota Kenta Daiki Takumi Yuki Yuka Yui Haruka Sakura Aiko Akiko
  Emi Keiko Mayumi Naoko Rina Yoko Yumi Kaori Satoshi Shinji Kazuki Ryota Daisuke Taro Ji-woo
  Ji-hoon Min-jun Seo-yeon Ji-ho Seo-jun Do-yun Ha-eun Su-bin Min-seo Ji-min Hyun-woo Sung-min Joon
  Jin Hye-jin Eun-ji Soo-jin Young-ho Minh Anh Linh Thao Huong Trang Hoa Tuan Duc Quang Thanh Hieu
  Khoa Phuong Somchai Siriporn Nattapong Kittisak Aung Kyaw Thida
  Jean Pierre Jacques Michel François Francois Philippe Nicolas Antoine Julien Mathieu Olivier
  Sébastien Laurent Thierry Léa Camille Manon Chloé Isabelle Nathalie Céline Amélie Élodie Margaux
  Hans Klaus Jürgen Wolfgang Stefan Andreas Markus Matthias Lukas Jonas Leon Maximilian Moritz
  Tobias Florian Sebastian Johannes Lena Lea Katharina Sabine Ursula Petra Monika Heike Birgit
  Giulia Giuseppe Giovanni Marco Luca Matteo Francesco Alessandro Lorenzo Stefano Paolo Roberto
  Antonio Fabio Federico Riccardo Davide Chiara Francesca Valentina Alessia Martina Federica Elena
  Silvia Paola Sofia Giorgia José Jose Juan Carlos Luis Javier Miguel Alejandro Pablo Diego Manuel
  Jorge Sergio Fernando Rafael Pedro Raúl Raul Álvaro Alvaro Andrés Andres Mateo Santiago Joaquín
  Lucía Lucia Carmen Isabel Ana Marta Paula Cristina Pilar Beatriz Raquel Inés Sofía Valeria Camila
  Daniela Gabriela Mariana João Joao Tiago Rodrigo Gonçalo Rui Joana Dmitri Dmitry Sergei Sergey
  Alexei Alexey Andrei Andrey Vladimir Nikolai Mikhail Igor Oleg Pavel Yuri Boris Viktor Anastasia
  Natalia Natasha Olga Tatiana Svetlana Ekaterina Yekaterina Irina Ksenia Polina Piotr Paweł
  Krzysztof Tomasz Marek Jakub Agnieszka Katarzyna Małgorzata Magdalena Lars Erik Anders Nils Johan
  Magnus Henrik Mikael Björn Bjorn Sven Astrid Ingrid Freja Sigrid Karin Kristina Pieter Daan Bram
  Ruben Sanne Femke Eva Dimitris Giorgos Nikos Kostas Yannis Eleni Katerina Nikola Marko Milan Luka
  Jelena Ivana Mihai Alexandru Ioana István László Zoltán Ferenc Katalin Moshe Yosef Avi Yael Noa
  Tamar Shira Eitan Ari Taylor Morgan Alex Riley Casey Cameron Avery Quinn Harper Jordan
`),
);

/**
 * Given names that are also everyday English words or places. They only count when the
 * sentence is not written in Title Case, where every word is capitalized anyway.
 */
export const AMBIGUOUS_GIVEN: ReadonlySet<string> = new Set(
  list(`Will Mark Bill Grace Hope Faith Joy Rose Frank Chase Hunter Miles Max Ray Guy Drew Sue Rob
  Dawn Summer Amber Ruby Jack Holly Lily Ivy Daisy Iris Penny Victoria Georgia Jordan Austin Madison
  Sydney Chelsea Dean Grant Said Salem Hung Joe Dev Raj Amani Imani Baraka Neema Tara Mina Nur`),
);

/** East Asian family names, which come before the given name in romanized names. */
export const SURNAMES_FIRST: ReadonlySet<string> = new Set(
  list(`Zhang Wang Liu Chen Yang Huang Zhao Zhou Xu Sun Zhu Guo Lin Gao Luo Zheng Xie Liang Tang
  Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Shin Kwon Hwang Ahn Yoo Hong Nguyen Tran Pham
  Hoang Phan Dang Bui Duong Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi
  Kato Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura Hayashi Shimizu`),
);

/** Lowercase or capitalized particles that may sit inside a surname. */
export const SURNAME_PARTICLES =
  'Al|al|El|el|Abu|Abd|abd|Ben|ben|Bin|bin|Ibn|ibn|Bint|bint|van|Van|von|Von|de|De|da|Da|di|Di|del|Del|della|der|den|du|Du|la|La|le|Le|dos|das|do|ter|zu|y';

/**
 * Words that turn a "Name Surname" match into a place or institution ("Jordan Valley",
 * "John F. Kennedy Airport", "King Fahd Road"), which should be translated, not protected.
 */
export const PLACE_WORDS: ReadonlySet<string> = new Set(
  list(`Street St Road Rd Avenue Ave Boulevard Blvd Lane Way Drive Highway Square Park Garden Gardens
  Airport Station Hospital Clinic University College School Academy Institute Bridge Mosque Church
  Cathedral Temple Center Centre Mall Tower Towers Hotel Bay Island Islands Lake River Mountain Mount
  Beach Museum Library Stadium Arena Hall Building Gate Market Souq Souk Palace Valley Coast City
  Falls Republic Kingdom Desert Port Harbour Harbor Canal Village Town County District Province
  Foundation Prize Award Awards Opera House Tech Memorial Plaza Terminal Hills Heights Springs`),
);

/** Multiword places whose first word is also a listed name ("Hong Kong", "Costa Rica"). */
export const NAME_LIKE_PLACES: ReadonlySet<string> = new Set([
  'Hong Kong',
  'Kuala Lumpur',
  'Sri Lanka',
  'Costa Rica',
  'Sierra Leone',
  'Santa Cruz',
  'Santa Monica',
  'Santa Barbara',
  'San Jose',
  'Tel Aviv',
  'Ho Chi Minh',
  'Abu Dhabi',
  'Victoria Falls',
  'Jordan Valley',
  'Lee County',
]);

/** Countries and large cities that can follow a given name ("Sydney Australia", "Ahmed Kuwait"). */
export const PLACE_NAMES: ReadonlySet<string> = new Set(
  list(`Afghanistan Albania Algeria Argentina Armenia Australia Austria Azerbaijan Bahrain Bangladesh
  Belarus Belgium Bolivia Bosnia Brazil Bulgaria Cambodia Cameroon Canada Chile China Colombia
  Croatia Cuba Cyprus Czechia Denmark Ecuador Egypt England Estonia Ethiopia Finland France Georgia
  Germany Ghana Greece Hungary Iceland India Indonesia Iran Iraq Ireland Israel Italy Japan Jordan
  Kazakhstan Kenya Korea Kuwait Latvia Lebanon Libya Lithuania Luxembourg Malaysia Mexico Morocco
  Nepal Netherlands Nigeria Norway Oman Pakistan Palestine Peru Philippines Poland Portugal Qatar
  Romania Russia Rwanda Scotland Senegal Serbia Singapore Slovakia Slovenia Somalia Spain Sudan
  Sweden Switzerland Syria Taiwan Tanzania Thailand Tunisia Turkey Uganda Ukraine Uruguay
  Uzbekistan Venezuela Vietnam Wales Yemen Zambia Zimbabwe Africa Europe Asia America Arabia
  London Paris Berlin Madrid Rome Moscow Dubai Doha Riyadh Jeddah Mecca Makkah Medina Cairo Istanbul
  Tehran Baghdad Beirut Amman Damascus Karachi Lahore Delhi Mumbai Dhaka Beijing Shanghai Tokyo
  Seoul Bangkok Manila Jakarta Toronto Chicago Boston Dallas Houston Miami Lagos Nairobi Manchester
  Sydney Melbourne Kuwait`),
);
